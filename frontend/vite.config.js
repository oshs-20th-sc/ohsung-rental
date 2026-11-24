import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const frontendDir = fileURLToPath(new URL('.', import.meta.url))
const requiredSettings = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
]

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'emulator') {
    throw new Error('Emulator 모드는 로컬 개발 서버에서만 사용할 수 있습니다.')
  }
  if (command === 'build' && mode !== 'demo') {
    const settings = loadEnv(mode, frontendDir, 'VITE_FIREBASE_')
    const missing = requiredSettings.filter((name) => !settings[name]?.trim())
    if (missing.length) {
      throw new Error(`Firebase 배포 설정을 입력해 주세요. ${missing.join(', ')} 설정이 필요합니다.`)
    }
    if (settings.VITE_FIREBASE_PROJECT_ID.trim().startsWith('demo-')) {
      throw new Error('배포 빌드에는 운영용 Firebase 프로젝트 ID가 필요합니다.')
    }
  }

  return {
    base: './',
    plugins: [react()],
    server: { host: 'localhost', port: 5173 },
  }
})
