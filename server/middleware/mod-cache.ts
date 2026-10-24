import { getRequestURL, setResponseHeader } from 'h3'

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  if (pathname === '/api/mods' || pathname.startsWith('/api/mods/')) {
    setResponseHeader(event, 'Cache-Control', 'no-store')
  }
})
