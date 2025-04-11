"use client"

import { useState, useEffect, useRef } from "react"

export default function VoiceChatbot() {
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [dotSize, setDotSize] = useState(40)
  const [volume, setVolume] = useState(0)

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const silenceStartRef = useRef<number | null>(null)
  const localWebSocketRef = useRef<WebSocket | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)

  // Initialize audio element
  useEffect(() => {
    audioElementRef.current = new Audio()
    return () => {
      if (audioElementRef.current) {
        audioElementRef.current.pause()
        audioElementRef.current = null
      }
    }
  }, [])

  // Update dot size based on volume with smoother animation
  useEffect(() => {
    if (!isRecording) return

    // Base size + volume amplification with smoother transition
    const targetSize = 40 + volume * 80

    // Animate the dot size change
    const animateDotSize = () => {
      setDotSize((current) => {
        const diff = targetSize - current
        // Ease towards target size
        const newSize = current + diff * 0.2
        return Math.min(Math.max(newSize, 40), 120) // Clamp between 40-120px
      })

      animationFrameRef.current = requestAnimationFrame(animateDotSize)
    }

    animationFrameRef.current = requestAnimationFrame(animateDotSize)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [volume, isRecording])

  // Detect silence for processing
  useEffect(() => {
    if (!isRecording || isProcessing) return

    if (volume < 0.05) {
      // Start counting silence
      if (silenceStartRef.current === null) {
        silenceStartRef.current = Date.now()
      } else if (Date.now() - silenceStartRef.current > 1500) {
        // 1.5 seconds of silence - process audio
        processAudio()
      }
    } else {
      // Reset silence counter if volume increases
      silenceStartRef.current = null
    }
  }, [volume, isRecording, isProcessing])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanupAudio()
      if (localWebSocketRef.current) {
        localWebSocketRef.current.close()
      }
    }
  }, [])

  // Initialize local WebSocket connection
  useEffect(() => {
    // Connect to local WebSocket server for text-to-speech
    // This would be your local service that converts text to speech
    const ws = new WebSocket("ws://localhost:3001")

    ws.onopen = () => {
      console.log("Connected to local WebSocket server")
    }

    ws.onmessage = (event) => {
      // Assuming the server sends back audio as a blob URL
      if (audioElementRef.current) {
        audioElementRef.current.src = event.data
        audioElementRef.current.play()
      }
    }

    ws.onerror = (error) => {
      console.error("WebSocket error:", error)
    }

    localWebSocketRef.current = ws

    return () => {
      ws.close()
    }
  }, [])

  // Toggle recording
  const toggleRecording = async () => {
    if (isRecording || isProcessing) {
      stopRecording()
    } else {
      await startRecording()
    }
  }

  // Initialize audio recording
  const startRecording = async () => {
    try {
      // Reset
      audioChunksRef.current = []
      silenceStartRef.current = null

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
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.8

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

      // Collect audio data
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      // Start recording
      mediaRecorder.start(100)

      setIsRecording(true)
    } catch (error) {
      console.error("Error initializing audio:", error)
    }
  }

  // Process audio after silence is detected
  const processAudio = async () => {
    if (audioChunksRef.current.length === 0) return

    setIsProcessing(true)
    setIsRecording(false)
    stopRecording()

    try {
      // Create audio blob from chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })

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
        throw new Error("Failed to transcribe audio")
      }

      const transcriptionData = await transcriptionResponse.json()

      if (!transcriptionData.text) {
        // No transcription
        setIsProcessing(false)
        return
      }

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
        }),
      })

      if (!chatResponse.ok) {
        throw new Error("Failed to get AI response")
      }

      const responseData = await chatResponse.json()
      const aiText = responseData.choices[0]?.message?.content

      if (aiText && localWebSocketRef.current?.readyState === WebSocket.OPEN) {
        // Send the AI text response to local WebSocket for text-to-speech
        localWebSocketRef.current.send(
          JSON.stringify({
            text: aiText,
          }),
        )
      }
    } catch (error) {
      console.error("Error processing audio:", error)
    } finally {
      setIsProcessing(false)
    }
  }

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    cleanupAudio()
    setIsRecording(false)
  }

  // Calculate volume from audio data
  const calculateVolume = (dataArray: Uint8Array) => {
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i]
    }
    const average = sum / dataArray.length
    return average / 255 // Normalize to 0-1 range
  }

  // Clean up audio resources
  const cleanupAudio = () => {
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

  return (
    <div className="cursor-pointer" onClick={!isProcessing ? toggleRecording : undefined}>
      {/* Animated dot */}
      <div
        className={`rounded-full transition-all ${
          isProcessing ? "bg-gray-400" : isRecording ? "bg-blue-500" : "bg-gray-300"
        }`}
        style={{
          width: `${dotSize}px`,
          height: `${dotSize}px`,
          transition: "width 0.1s, height 0.1s, background-color 0.3s",
        }}
      />
    </div>
  )
}

