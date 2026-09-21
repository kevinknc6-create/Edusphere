import { createApp } from './app.js'
import { env } from './config.js'

const app = createApp()
const server = app.listen(env.PORT, () => console.log(`EduSphere API listening on port ${env.PORT}`))

function shutdown(signal: string) {
    console.log(`${signal} received; shutting down`)
    server.close(() => process.exit(0))
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
