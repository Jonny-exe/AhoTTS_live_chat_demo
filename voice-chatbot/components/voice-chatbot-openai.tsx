"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

export default function VoiceChatbot() {
  const [isRecording, setIsRecording] = useState(false)
  const [transcription, setTranscription] = useState("")
  const [dotSize, setDotSize] = useState(60)
  const [volume, setVolume] = useState(0)
  const [status, setStatus] = useState("Click to start")

  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const animationFrameRef = useRef<number | null>(null)
  const processingRef = useRef<boolean>(false)

  // Update dot size based on volume with smoother animation
  useEffect(() => {
    if (!isRecording) return

    // Base size + volume amplification with smoother transition
    const targetSize = 60 + volume * 100

    // Animate the dot size change
    const animateDotSize = () => {
      setDotSize((current) => {
        const diff = targetSize - current
        // Ease towards target size
        const newSize = current + diff * 0.2
        return Math.min(Math.max(newSize, 60), 160) // Clamp between 60-160px
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

  // Clean up on unmount
  useEffect(() => {
    return () => {
      cleanupAudio()
    }
  }, [])

  // Toggle recording
  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording()
    } else {
      await startRecording()
    }
  }

  // Initialize audio recording
  const startRecording = async () => {
    try {
      // Reset transcription
      setTranscription("")
      audioChunksRef.current = []

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

          // Process audio in chunks for streaming transcription
          if (!processingRef.current && audioChunksRef.current.length > 0) {
            processAudioChunk()
          }
        }
      }

      // Start recording
      mediaRecorder.start(1000) // Collect data every second for streaming

      setIsRecording(true)
      setStatus("Listening...")
    } catch (error) {
      console.error("Error initializing audio:", error)
      setStatus("Microphone access denied")
    }
  }

  // Process audio chunk for streaming transcription
  const processAudioChunk = async () => {
    if (processingRef.current || audioChunksRef.current.length === 0) return

    processingRef.current = true

    try {
      // Create audio blob from chunks
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })

      // Create form data for API request
      const formData = new FormData()
      formData.append("file", audioBlob, "audio.webm")
      formData.append("model", "whisper-1")
      formData.append("language", "en")

      // Send to OpenAI API for transcription
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY}`,
        },
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Failed to transcribe audio")
      }

      const data = await response.json()

      if (data.text) {
        setTranscription((prev) => prev + " " + data.text)
      }
    } catch (error) {
      console.error("Error processing audio chunk:", error)
    } finally {
      // Keep the last few chunks for context
      if (audioChunksRef.current.length > 5) {
        audioChunksRef.current = audioChunksRef.current.slice(-2)
      }
      processingRef.current = false
    }
  }

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    cleanupAudio()
    setIsRecording(false)
    setStatus("Click to start")

    // Process any remaining audio
    if (audioChunksRef.current.length > 0) {
      processAudioChunk()
    }
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
    <div className="flex flex-col items-center">
      {/* Voice visualization container */}
      <div
        className="w-64 h-64 rounded-full bg-[#f0f5f7] border-2 border-[#4a6d7c] flex items-center justify-center cursor-pointer"
        onClick={toggleRecording}
      >
        {/* Animated dot */}
        <div
          className={cn("rounded-full bg-[#4a6d7c] transition-all", isRecording ? "animate-pulse" : "")}
          style={{
            width: `${dotSize}px`,
            height: `${dotSize}px`,
            transition: "width 0.1s, height 0.1s",
          }}
        />
      </div>

      {/* Status indicator */}
      <div className="mt-4 text-[#4a6d7c]">{status}</div>

      {/* Transcription area */}
      <div className="mt-8 w-full p-4 bg-white border border-[#4a6d7c] rounded-md min-h-[100px]">
        <p className="text-sm text-[#4a6d7c] mb-2">Transcription:</p>
        <p className="text-[#333]">{transcription || "Your transcription will appear here..."}</p>
      </div>
    </div>
  )
}

