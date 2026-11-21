import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { POMODORO_MAX_MINUTES, POMODORO_MIN_MINUTES } from '../../shared/types'
import './prompt.css'

const params = new URLSearchParams(location.search)
const initialValue = params.get('initial') ?? '25'

function Prompt(): JSX.Element {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (): void => {
    const minutes = Number(value)
    if (!Number.isInteger(minutes)) {
      setError('请输入整数')
      return
    }
    if (minutes < POMODORO_MIN_MINUTES || minutes > POMODORO_MAX_MINUTES) {
      setError(`请输入 ${POMODORO_MIN_MINUTES} ~ ${POMODORO_MAX_MINUTES} 之间的整数`)
      return
    }
    window.api.submitPrompt(minutes)
  }

  const cancel = (): void => {
    window.api.cancelPrompt()
  }

  return (
    <div className="prompt-card">
      <p className="prompt-title">自定义专注时长</p>

      <div className="prompt-row">
        <input
          ref={inputRef}
          className={`prompt-input${error ? ' has-error' : ''}`}
          type="number"
          min={POMODORO_MIN_MINUTES}
          max={POMODORO_MAX_MINUTES}
          step={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') cancel()
          }}
        />
        <span className="prompt-unit">分钟</span>
      </div>

      <p className={`prompt-hint${error ? ' is-error' : ''}`}>
        {error || `${POMODORO_MIN_MINUTES} ~ ${POMODORO_MAX_MINUTES} 分钟`}
      </p>

      <div className="prompt-actions">
        <button type="button" className="btn btn-ghost" onClick={cancel}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onClick={submit}>
          开始
        </button>
      </div>
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<Prompt />)
}
