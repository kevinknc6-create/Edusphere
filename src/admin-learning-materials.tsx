import { createRoot } from 'react-dom/client'
import AdminLearningMaterialsEntry from './components/AdminLearningMaterialsEntry'
import './index.css'
import './App.css'
import './admin-learning-materials.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Learning Materials application root is missing.')

const root = createRoot(rootElement)
root.render(<AdminLearningMaterialsEntry />)

const reportHeight = () => {
    window.parent.postMessage({
        type: 'edusphere-admin-materials:height',
        height: document.documentElement.scrollHeight,
    }, window.location.origin)
}

const observer = new ResizeObserver(reportHeight)
observer.observe(document.body)
window.addEventListener('load', reportHeight)
window.addEventListener('resize', reportHeight)
