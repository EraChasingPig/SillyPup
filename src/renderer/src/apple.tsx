import { createRoot } from 'react-dom/client'
import appleUrl from './assets/apple.png'
import './apple.css'

function Apple(): JSX.Element {
  return <img className="apple" src={appleUrl} alt="" draggable={false} />
}

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<Apple />)
}
