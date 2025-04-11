"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { Mic, Volume2, Loader2 } from "lucide-react"

export default function VoiceChatbot() {
  const [isListening, setIsListening] = useState(false)
  const [response, setResponse] = useState("")
  const [dotSize, setDotSize] = useState(100)
  const [volume, setVolume] = useState(0)
  const [status, setStatus] = useState("Starting...")
  const [error, setError] = useState<string | null>(null)
  const [transcription, setTranscription] = useState<string | null>(null)

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const processingRef = useRef<boolean>(false)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Initialize audio recording
  useEffect(() => {
    initializeAudio()

    return () => {
      cleanupAudio()
    }
  }, [])

  // Update dot size based on volume with smoother animation
  useEffect(() => {
    // Base size + volume amplification with smoother transition
    const targetSize = 100 + volume * 300

    // Animate the dot size change
    const animateDotSize = () => {
      setDotSize((current) => {
        const diff = targetSize - current
        // Ease towards target size
        const newSize = current + diff * 0.2
        return Math.min(Math.max(newSize, 100), 400) // Clamp between 100-400px
      })

      animationFrameRef.current = requestAnimationFrame(animateDotSize)
    }

    animationFrameRef.current = requestAnimationFrame(animateDotSize)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [volume])

  // Detect silence for processing
  useEffect(() => {
    if (volume < 0.05 && isListening && !processingRef.current) {
      // Start counting silence
      if (silenceStartRef.current === null) {
        silenceStartRef.current = Date.now()
      } else if (Date.now() - silenceStartRef.current > 1500 && silenceTimeoutRef.current === null) {
        // 1.5 seconds of silence
        silenceTimeoutRef.current = setTimeout(() => {
          processAudioChunks()
          silenceTimeoutRef.current = null
          silenceStartRef.current = null
        }, 200) // Small additional delay
      }
    } else {
      // Reset silence counter if volume increases
      silenceStartRef.current = null
      if (silenceTimeoutRef.current !== null) {
        clearTimeout(silenceTimeoutRef.current)
        silenceTimeoutRef.current = null
      }
    }
  }, [volume, isListening])

  // Initialize audio recording
  const initializeAudio = async () => {
    try {
      setError(null)

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioContextRef.current = audioContext

      // Create analyser for volume detection
      const analyser = audioContext.createAnalyser()
      analyserRef.current = analyser
      analyser.fftSize = 1024 // Higher for better frequency resolution
      analyser.smoothingTimeConstant = 0.8 // Smoother transitions

      // Create source from stream
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      // Create script processor for volume monitoring
      const processor = audioContext.createScriptProcessor(2048, 1, 1)
      processorRef.current = processor

      // Connect processor
      analyser.connect(processor)
      processor.connect(audioContext.destination)

      // Set up volume monitoring
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      processor.onaudioprocess = () => {
        analyser.getByteFrequencyData(dataArray)
        const currentVolume = calculateVolume(dataArray)
        setVolume(currentVolume)
      }

      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      })
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      // Start recording
      mediaRecorder.start(100) // Collect data every 100ms

      setIsListening(true)
      setStatus("Listening...")
    } catch (error) {
      console.error("Error initializing audio:", error)
      setError("Could not access microphone. Please ensure you have granted microphone permissions.")
      setStatus("Error")
    }
  }

  // Process collected audio chunks
  const processAudioChunks = async () => {
    if (audioChunksRef.current.length === 0 || processingRef.current) return

    processingRef.current = true
    setStatus("Processing...")
    setError(null)

    try {
      // Pause recording temporarily
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop()
      }

      // Create audio blob from chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
      audioChunksRef.current = [] // Clear chunks for next recording

      // Create form data for API request
      const formData = new FormData()
      formData.append("file", audioBlob, "audio.webm")
      formData.append("model", "whisper-1")

      // Send to OpenAI API for transcription
      const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
        },
        body: formData,
      })

      if (!transcriptionResponse.ok) {
        const errorData = await transcriptionResponse.json().catch(() => ({}))
        throw new Error(`Transcription failed: ${errorData.error?.message || transcriptionResponse.statusText}`)
      }

      const transcriptionData = await transcriptionResponse.json()

      if (!transcriptionData.text || transcriptionData.text.trim() === "") {
        // No transcription, resume recording
        setTranscription("(No speech detected)")
        restartRecording()
        return
      }

      // Set transcription
      setTranscription(transcriptionData.text)

      // Send transcription to OpenAI for response
      const chatResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: "You are a helpful voice assistant. Keep responses concise and conversational.",
            },
            {
              role: "user",
              content: transcriptionData.text,
            },
          ],
          stream: true,
        }),
      })

      if (!chatResponse.ok) {
        const errorData = await chatResponse.json().catch(() => ({}))
        throw new Error(`AI response failed: ${errorData.error?.message || chatResponse.statusText}`)
      }

      // Process the streaming response
      const reader = chatResponse.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        setResponse("") // Clear previous response

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)

          // Parse SSE format
          const lines = chunk.split("\n").filter((line) => line.trim() !== "")
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6)
              if (data === "[DONE]") continue

              try {
                const parsed = JSON.parse(data)
                const content = parsed.choices[0]?.delta?.content
                if (content) {
                  setResponse((prev) => prev + content)
                }
              } catch (e) {
                console.error("Error parsing SSE:", e)
              }
            }
          }
        }
      }
    } catch (error) {
      console.error("Error processing audio:", error)
      setError(`${error instanceof Error ? error.message : "Error processing audio"}`)
    } finally {
      // Resume recording
      restartRecording()
    }
  }

  // Restart recording after processing
  const restartRecording = async () => {
    if (streamRef.current && (!mediaRecorderRef.current?.state || mediaRecorderRef.current?.state === "inactive")) {
      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: "audio/webm",
      })

      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.start(100)
    }

    setIsListening(true)
    setStatus("Listening...")
    processingRef.current = false
  }

  // Calculate volume from audio data
  const calculateVolume = (dataArray: Uint8Array) => {
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i]
    }
    const average = sum / dataArray.length
    // Normalize to 0-1 range
    return average / 255
  }

  // Clean up audio resources
  const cleanupAudio = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current)
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
    }

    if (processorRef.current) {
      processorRef.current.disconnect()
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect()
    }

    if (audioContextRef.current) {
      audioContextRef.current.close()
    }
  }

  // Get color based on volume
  const getDotColor = () => {
    // Interpolate between colors based on volume
    const r = Math.round(59 + volume * 196) // 59 to 255
    const g = Math.round(130 + volume * 125) // 130 to 255
    const b = Math.round(246 - volume * 46) // 246 to 200

    return `rgb(${r}, ${g}, ${b})`
  }

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-md">
      {/* Animated dot */}
      <div className="relative flex items-center justify-center">
        <div
          className={cn("rounded-full transition-all duration-100 shadow-lg", isListening ? "animate-pulse" : "")}
          style={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            background: `radial-gradient(circle, ${getDotColor()} 0%, rgba(37, 99, 235, 0.8) 100%)`,
            transition: "width 0.1s, height 0.1s, background 0.3s",
          }}
        />

        {/* Icon overlay */}
        <div className="absolute pointer-events-none">
          {status === "Processing..." ? (
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          ) : isListening ? (
            <Volume2 className="w-8 h-8 text-white animate-pulse" />
          ) : (
            <Mic className="w-8 h-8 text-white" />
          )}
        </div>
      </div>

      {/* Status indicator */}
      <div className="mt-4 text-white text-center">{status}</div>

      {/* Error message */}
      {error && <div className="mt-2 text-red-400 text-sm text-center max-w-xs">{error}</div>}

      {/* Transcription */}
      {transcription && (
        <div className="mt-6 p-3 bg-gray-800/50 rounded-lg text-gray-300 text-sm max-w-xs">
          <p className="text-xs text-gray-400 mb-1">You said:</p>
          <p className="italic">{transcription}</p>
        </div>
      )}

      {/* Response area */}
      {response && (
        <div className="mt-4 p-4 rounded-lg bg-gray-800/80 text-white max-w-xs">
          <p className="text-xs text-gray-400 mb-1">Response:</p>
          <p>{response}</p>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-8 text-gray-400 text-xs text-center max-w-xs">
        <p>Speak naturally and pause when you're done. The assistant will respond after 1.5 seconds of silence.</p>
      </div>
    </div>
  )
}

