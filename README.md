# 빌리러 오성 웹

학교 물품의 대여와 반납을 관리하는 React 웹 앱입니다. 브라우저에서 Firebase Authentication과 Cloud Firestore에 연결하고, `frontend/dist`를 정적 사이트로 배포합니다.

## 기능

- 학생은 7자리 학생 ID와 개인 비밀번호로 로그인하고, 물품을 대여하거나 반납을 신청합니다.
- 관리자는 대여·반납 요청을 처리하고, 물품과 번호를 관리합니다.
- 학생과 관리자는 대여 이력을 확인합니다. 관리자 목록은 검색·필터 및 페이지 이동을 지원합니다.
- 대여 전환은 물품과 대여 기록을 Firestore 트랜잭션으로 함께 갱신합니다. 권한은 Firestore Security Rules에서 확인합니다.

## 기술 스택

- React 18, React Router, Vite
- Firebase Authentication, Cloud Firestore
- Node.js `24.22.3` (`.node-version`, `.nvmrc`)
- Firebase Emulator Suite와 Node 내장 테스트 러너

## 아키텍처

`frontend/src/pages/`는 화면, `frontend/src/auth/`는 로그인 세션, `frontend/src/services/`는 Firebase 조회와 대여·재고 변경 로직을 담당합니다. `frontend/src/firebase/client.js`가 브라우저 Firebase 연결을 선택합니다.

가상 데모, 로컬 Authentication·Firestore Emulator, 실제 Firebase 웹 설정을 쓰는 세 가지 실행 방식이 있습니다. 정적 빌드는 Vite가 생성하며, `HashRouter`가 서버 경로 재작성 없이 화면 이동을 처리합니다.

저장소 루트의 `firestore.rules`와 `firestore.indexes.json`은 Firestore 권한과 쿼리 인덱스의 기준 파일입니다. `firebase.json`은 이 파일과 로컬 Emulator 주소를 연결합니다.

## 저장소 역할

- **이 웹 저장소**는 React 화면, 브라우저 Firebase 연동, Firestore 규칙·인덱스, 로컬 데모·Emulator 테스트와 정적 배포 설정을 관리합니다.
- **`rental-setup`**은 신뢰된 운영자 환경에서 실제 학생 계정 발급과 기존 재고 마이그레이션을 담당합니다. 명단, 운영 자격 증명, 운영 데이터 변경은 해당 도구의 절차로만 처리합니다.
- 과거 Flask·MySQL 앱과 기존 SQL 데이터는 이 정적 Firebase 앱에 포함하지 않습니다.

웹 저장소의 `frontend/scripts/`에 남은 계정·재고 스크립트는 회귀 테스트와 가상 Emulator 준비용입니다. 실제 Firebase 프로젝트를 읽거나 변경할 수 없도록 로컬 데모 프로젝트와 loopback Emulator에 제한합니다.

## 로컬 개발

저장소 루트에서 Node.js 버전을 선택한 뒤 프런트엔드 의존성을 설치합니다.

```sh
nvm install
nvm use
node -v
cd frontend
npm ci
npm run dev:demo
```

`node -v`는 `v24.22.3`이어야 합니다. 별도 Firebase 프로젝트 설정 없이 출력된 로컬 주소에서 화면을 확인할 수 있습니다.

## 데모 모드

데모는 브라우저 메모리 안의 가상 계정과 재고만 사용합니다. Firebase에 연결하지 않으며 새로고침하면 로그인 상태와 변경 내용이 초기화됩니다.

| 역할 | 로그인 ID | 비밀번호 |
| --- | --- | --- |
| 학생 | `2610710` | `demo-only-123` |
| 관리자 | `admin@example.test` | `demo-only-123` |

데모 계정과 데이터는 `frontend/src/services/demoData.js`에 있습니다. 실제 이름이나 운영 계정 정보를 넣지 마세요.

## Firebase Emulator

Java 21 이상이 필요합니다. `npm ci`가 저장소의 개발 도구를 설치하므로 Firebase CLI를 전역 설치하거나 `rental-setup`을 설치할 필요가 없습니다.

첫 번째 터미널에서 Emulator를 시작합니다.

```sh
cd frontend
npm run emulators
```

두 번째 터미널에서 가상 Auth 계정과 데이터를 준비하고 웹 앱을 실행합니다.

```sh
cd frontend
npm run emulators:seed
npm run dev:emulator
```

웹 앱과 테스트용 스크립트는 `demo-ohsung-rental` 및 `127.0.0.1:9099` (Auth), `127.0.0.1:8080` (Firestore)만 사용합니다. 가상 로그인 값은 데모 계정 표와 같습니다. 테스트 비밀번호를 변경했다면 Emulator를 다시 시작하고 시드를 실행하세요.

## 테스트와 정적 검사

```sh
npm test
npm run lint
npm run build:demo
```

`npm test`는 자체 Auth·Firestore Emulator 세션을 실행합니다. 수동으로 켠 Emulator와 기본 포트가 겹치면 먼저 수동 Emulator를 종료하세요. 기존 회귀 테스트는 대여 동시성, Rules 권한, 번호 중복, 재고 마이그레이션 계획, 계정 발급·재시도, 대량 계정 처리와 페이지 조회를 검증합니다. 테스트는 가상 Emulator 데이터만 변경합니다.

## Firebase 백엔드 준비

운영 호스팅 전에 대상 Firebase 프로젝트에서 다음을 준비합니다.

1. Firebase 웹 앱을 등록하고 Cloud Firestore 기본 데이터베이스를 준비합니다.
2. Authentication의 이메일/비밀번호 로그인을 활성화하고 사용할 호스팅 도메인을 승인 도메인에 추가합니다.
3. 저장소의 `firestore.rules`와 `firestore.indexes.json`을 검토해 대상 프로젝트에 적용하고, 복합 인덱스가 준비될 때까지 기다립니다.
4. 실제 관리자 계정과 학생 계정 발급, 기존 재고 데이터 마이그레이션은 `rental-setup` 운영 절차로 수행합니다.

이 웹 앱은 운영 계정이나 재고를 만들거나 이전하지 않습니다. Firebase 웹 설정과 보안 경계는 아래 [환경 변수](#환경-변수) 및 [보안](#보안) 절을 참고하세요.

## Cloudflare Pages

프로덕션 사이트는 Cloudflare Pages의 사용자 지정 도메인 `rental.coshsc.kr`에 배포합니다.

| 설정 | 값 |
| --- | --- |
| Production branch | `main` |
| Root directory | `frontend` |
| Framework preset | React (Vite) |
| Build command | `npm ci && npm run build:release` |
| Build output directory | `dist` |
| Node.js | `NODE_VERSION=24.22.3` |
| 종속성 자동 설치 | `SKIP_DEPENDENCY_INSTALL=1` |

Cloudflare 변수에 네 개의 `VITE_FIREBASE_*` 웹 설정을 등록합니다. 빌드 명령에 포함된 `npm ci`가 lockfile 기준으로 의존성을 설치합니다. 별도 업로드가 필요하면 `frontend/dist`를 Cloudflare Pages Direct Upload에 사용합니다. [Cloudflare Pages 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/)

## GitHub Pages

대상 저장소는 [oshs-20th-sc/ohsung-rental](https://github.com/oshs-20th-sc/ohsung-rental)이며, 주소는 `https://oshs-20th-sc.github.io/ohsung-rental/`입니다. Pages의 Source를 **GitHub Actions**로 선택하고, Actions Variables에 아래 Firebase 웹 설정 네 값을 등록합니다.

저장소의 `.github/workflows/pages.yml`은 `workflow_dispatch` 수동 실행만 지원합니다. **Actions → Deploy GitHub Pages → Run workflow**에서 시작합니다. 빌드는 `frontend`에서 `npm ci && npm run build:release`를 실행하고 `frontend/dist`만 배포합니다. Firebase Authentication 승인 도메인에 `oshs-20th-sc.github.io`를 추가하세요.

## 환경 변수

로컬 release 빌드에는 `frontend/.env.local`, 호스팅 빌드에는 플랫폼의 환경 변수 저장소에 다음 네 값을 넣습니다. 키와 예시 형식은 [`frontend/.env.example`](frontend/.env.example)에 있습니다.

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

`npm run build:release`는 네 값이 모두 있어야 하며, `VITE_FIREBASE_PROJECT_ID`가 `demo-`로 시작하면 중단됩니다. `VITE_*` 값은 브라우저 번들에 공개됩니다. Admin SDK 서비스 계정, 비공개 키, 관리자 비밀번호 또는 학생 명단을 넣지 마세요.

백엔드를 교체할 때는 운영 CLI로 새 Firebase 프로젝트를 준비한 뒤 호스팅의 네 값을 함께 변경하고 재배포합니다. 기존 계정 및 대여 데이터 이전은 백엔드 구축과 별도입니다.

## 보안

- 브라우저 Firebase 설정은 공개값입니다. 데이터 권한은 Firebase Authentication과 `firestore.rules`에서 강제합니다.
- 학생은 발급된 계정과 활성 프로필이 일치해야 데이터에 접근할 수 있습니다. 관리자 권한은 `roles/{uid}` 문서를 기준으로 Rules가 확인합니다.
- 학생 ID는 로그인 시 Firebase Auth의 내부 별칭으로 변환됩니다. 일반 웹 도메인이나 메일함을 만들지 않습니다.
- 대여·반납은 트랜잭션과 Firestore Rules가 함께 검증합니다. 학생은 본인의 대여만 신청할 수 있고, 반납 승인은 관리자 권한으로 처리합니다.
- 실제 계정 발급, 계정 회수, 재고 마이그레이션, 개인정보 보관·정리는 승인된 운영자가 `rental-setup` 및 학교 절차로 처리합니다. 운영 명단과 Admin 자격 증명은 웹 저장소, 환경 변수, 빌드 산출물에 두지 않습니다.

## CLI와 운영 도구

실제 학생 계정 발급, 새 백엔드 구성, 기존 재고 초기화는 운영 매뉴얼을 따릅니다. [rental-setup 운영 매뉴얼](https://github.com/oshs-20th-sc/rental-setup#readme)

이 저장소의 `frontend/scripts/provision-students.mjs`와 `frontend/scripts/migrate-inventory.mjs`는 Emulator 회귀 테스트를 위한 테스트 지원 코드입니다. 로컬 데모 프로젝트와 loopback Emulator에서만 동작하며, 운영 프로젝트 옵션은 거부합니다. 웹을 빌드하거나 Emulator 회귀 테스트를 실행할 때 `rental-setup` CLI는 필요하지 않습니다.

## 라이선스

이 프로젝트는 [MIT License](LICENSE)로 배포됩니다.
