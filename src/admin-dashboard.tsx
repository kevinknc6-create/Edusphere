import { createRoot } from 'react-dom/client'
import AdminDashboardEntry from './components/AdminDashboardEntry'
import './App.css'
import './admin-dashboard.css'

const rootElement = document.getElementById('view')
if (!rootElement) throw new Error('Admin dashboard root element is missing.')
const dashboardRoot = createRoot(rootElement)
if (import.meta.hot) import.meta.hot.dispose(() => dashboardRoot.unmount())
dashboardRoot.render(<AdminDashboardEntry />)
