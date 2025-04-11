"use client"

import { useState, useEffect, useRef } from "react"
import { useAudioRecorder } from "@/hooks/use-audio-recorder"
import { cn } from "@/lib/utils"

export default function VoiceChatbot() {
  const [isListening, setIsListening] = useState(false)
  const [response, setResponse] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [dotSize, setDotSize] = useState(100)
  const [transcription, setTranscription] = useState("")

  const { startRecording, stopRecording, isRecording, volume, getAudioBlob } = useAudioRecorder()

  const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Start recording automatically when component mounts
  useEffect(() => {
    const initRecording = async () => {
      await startRecording()
      setIsListening(true)
    }

    initRecording()

    return () => {
      if (isRecording) {
        stopRecording()
      }
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current)
      }
    }
  }, [])

  // Update dot size based on volume
  useEffect(() => {
    if (volume !== undefined) {
      // Scale the dot size based on volume (0-100 base size + volume amplification)
      const newSize = 100 + volume * 200
      setDotSize(Math.min(Math.max(newSize, 100), 300)) // Clamp between 100-300px
    }
  }, [volume])

  // Process audio when silence is detected
  useEffect(() => {
    // If volume is very low for a period, process the audio
    if (volume !== undefined && volume < 0.05 && isListening && !isLoading) {
      if (processingTimeoutRef.current === null) {
        processingTimeoutRef.current = setTimeout(async () => {
          await processAudio()
          processingTimeoutRef.current = null
        }, 2000) // Wait 2 seconds of silence before processing
      }
    } else if (processingTimeoutRef.current !== null) {
      clearTimeout(processingTimeoutRef.current)
      processingTimeoutRef.current = null
    }
  }, [volume, isListening, isLoading])

  // Process audio and send to API
  const processAudio = async () => {
    if (!isRecording) return

    try {
      setIsLoading(true)

      // Temporarily stop recording while processing
      await stopRecording()
      setIsListening(false)

      // Get the recorded audio blob
      const audioBlob = await getAudioBlob()
      if (!audioBlob) {
        console.error("No audio recorded")
        return
      }

      // Create form data to send to API
      const formData = new FormData()
      formData.append("audio", audioBlob, "audio.webm")

      // Send to our API endpoint
      const response = await fetch("/api/chat", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Failed to process audio")
      }

      // Process the streaming response
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let responseText = ""

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          responseText += chunk
          setResponse((prev) => prev + chunk)
        }
      }

      // Resume recording after processing
      await startRecording()
      setIsListening(true)
    } catch (error) {
      console.error("Error processing audio:", error)
    } finally {
      setIsLoading(false)

      // If recording was stopped, restart it
      if (!isRecording) {
        await startRecording()
        setIsListening(true)
      }
    }
  }

  return (
    <div className="flex flex-col items-center justify-center">
      {/* Animated dot */}
      <div
        className={cn(
          "rounded-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-100",
          isListening ? "animate-pulse" : "",
        )}
        style={{
          width: `${dotSize}px`,
          height: `${dotSize}px`,
          transition: "width 0.1s, height 0.1s",
        }}
      />

      {/* Status indicator */}
      <div className="mt-4 text-white">
        {isLoading ? "Processing..." : isListening ? "Listening..." : "Starting..."}
      </div>

      {/* Response area */}
      {response && (
        <div className="mt-8 max-w-md rounded-lg bg-gray-800 p-4 text-white">
          <p>{response}</p>
        </div>
      )}
    </div>
  )
}

