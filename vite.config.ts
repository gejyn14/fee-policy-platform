import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tailscale Funnel로 공용 인터넷에 노출할 때만 켜는 스위치: `npm run dev:funnel`이 TS_FUNNEL=1로 실행.
// 로컬 dev(`npm run dev`)에는 영향 없음.
const viaFunnel = process.env.TS_FUNNEL === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // IPv4 로프백에만 바인딩 — LAN엔 노출하지 않고, Funnel(로컬 127.0.0.1:5173 프록시)만 접근한다.
    host: '127.0.0.1',
    port: 5173,
    // Funnel의 MagicDNS 호스트(*.ts.net)에서 오는 요청의 Host 헤더를 허용(미허용 시 Vite가 403).
    allowedHosts: ['.ts.net'],
    // Funnel 경유(https://<host>:8443) 접속 시 HMR 웹소켓을 공용 포트로 연결. 로컬 dev엔 미적용.
    ...(viaFunnel ? { hmr: { protocol: 'wss', clientPort: 8443 } } : {}),
  },
})
