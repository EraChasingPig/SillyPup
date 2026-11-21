import { createRoot } from 'react-dom/client'
import './bubble.css'

const params = new URLSearchParams(location.search)
const text = params.get('text') ?? '时间到咯，休息两分钟吧'

function Bubble(): JSX.Element {
  return (
    <div className="bubble-wrap">
      <div className="bubble">
        <p className="bubble-text">{text}</p>
      </div>
      <div className="bubble-tail" />
    </div>
  )
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<Bubble />)
}
