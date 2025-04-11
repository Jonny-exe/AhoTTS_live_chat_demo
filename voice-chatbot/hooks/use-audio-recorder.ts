"use client"

import { useState, useEffect, useRef } from "react"

interface AudioRecorderOptions {
  onVolumeChange?: (volume: number) => void
  silenceThreshold?: number
  silenceTimeout?: number
}

export function useAudioRecorder({
  onVolumeChange,
  silenceThreshold = 0.05,
  silenceTimeout = 1500,
}: AudioRecorderOptions = {}) {
  const [isRecording, setIsRecording] = useState(false)
  const [volume, setVolume] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const silenceStartRef = useRef<number | null>(null)
  const silenceDetectedRef = useRef<boolean>(false)

  // Initialize audio recording
  const startRecording = async () => {
    try {
      setError(null)
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

        if (onVolumeChange) {
          onVolumeChange(currentVolume)
        }

        // Detect silence
        if (currentVolume < silenceThreshold) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now()
          } else if (Date.now() - silenceStartRef.current > silenceTimeout && !silenceDetectedRef.current) {
            silenceDetectedRef.current = true
          }
        } else {
          silenceStartRef.current = null
          silenceDetectedRef.current = false
        }
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
      mediaRecorder.start(100)
      setIsRecording(true)
    } catch (error) {
      console.error("Error starting recording:", error)
      setError(`Could not start recording: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop()
    }

    setIsRecording(false)
  }

  // Get audio blob
  const getAudioBlob = async (): Promise<Blob | null> => {
    if (audioChunksRef.current.length === 0) {
      return null
    }

    return new Blob(audioChunksRef.current, { type: "audio/webm" })
  }

  // Clear audio chunks
  const clearAudioChunks = () => {
    audioChunksRef.current = []
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

  // Check if silence is detected
  const isSilenceDetected = () => {
    return silenceDetectedRef.current
  }

  // Reset silence detection
  const resetSilenceDetection = () => {
    silenceStartRef.current = null
    silenceDetectedRef.current = false
  }

  // Clean up resources
  const cleanup = () => {
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

    setIsRecording(false)
  }

  // Clean up on unmount
  useEffect(() => {
    return cleanup
  }, [])

  return {
    startRecording,
    stopRecording,
    isRecording,
    volume,
    error,
    getAudioBlob,
    clearAudioChunks,
    isSilenceDetected,
    resetSilenceDetection,
    cleanup,
  }
}

