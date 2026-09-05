import './LoadingScreen.css'

export interface LoadingScreenProps {
  title: string
  subtitle: string
  /** 0..1 */
  progress: number
  status: string
  detail?: string
}

export function LoadingScreen({ title, subtitle, progress, status, detail }: LoadingScreenProps) {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)))
  return (
    <div className="loading-screen">
      <div className="loading-screen__title">{title}</div>
      <div className="loading-screen__subtitle">{subtitle}</div>
      <div className="loading-screen__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="loading-screen__bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-screen__status">{status}</div>
      {detail && <div className="loading-screen__detail">{detail}</div>}
    </div>
  )
}
