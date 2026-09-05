import { useEffect, useRef } from 'react'
import type { Renderer } from '../render/Renderer'
import './GameCanvas.css'

export interface GameCanvasProps {
  /** Called once with the canvas; return a renderer to own it, plus a cleanup. */
  onMount: (canvas: HTMLCanvasElement) => { renderer: Renderer; dispose: () => void }
}

export function GameCanvas({ onMount }: GameCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const onMountRef = useRef(onMount)
  onMountRef.current = onMount

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const { renderer, dispose } = onMountRef.current(canvas)
    renderer.start()
    return () => {
      renderer.stop()
      dispose()
    }
  }, [])

  return <canvas ref={ref} className="game-canvas" tabIndex={0} />
}
