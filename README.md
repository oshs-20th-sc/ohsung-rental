# 빌리러 오성

학교 물품의 대여·반납을 관리하는 웹 앱입니다. React/Vite로 빌드한 `frontend/dist`를 정적 호스팅하고, 브라우저에서 Firebase Authentication 및 Cloud Firestore에 연결합니다.

## 로컬 실행

이 프로젝트는 **Node.js 24.22.3 LTS**를 기준으로 검증합니다. 루트의 `.nvmrc`와 `.node-version`으로 버전을 고정하며, `package.json`은 24.22.3 이상인 24.x를 지원합니다. Firebase Emulator에는 Java 21 이상을 사용합니다.

nvm을 사용하는 경우 저장소 루트에서 `nvm install`과 `nvm use`를 실행해 프로젝트의 Node를 선택합니다. 이후 `node -v`로 버전을 확인합니다.

```sh
cd frontend
npm ci
npm run dev:demo
```

데모 모드는 가상 계정과 재고를 사용합니다. 데이터와 로그인 상태는 새로고침하면 초기화됩니다. 같은 로그인 화면에 학생 ID `2610710` 또는 관리자 이메일 `admin@example.test`를 입력합니다. 테스트 비밀번호는 `demo-only-123`입니다. 비밀번호 변경은 Firebase 또는 Emulator에서 동작합니다.

### Firebase Emulator에서 학생·관리자 기능 확인

`frontend`의 첫 번째 터미널에서 `npm run emulators`를 실행합니다. 두 번째 터미널에서 아래 명령을 실행하고 출력된 Vite 주소를 엽니다.

```sh
npm run emulators:seed
npm run dev:emulator
```

위 가상 계정을 사용합니다. 시드는 루프백 주소의 `demo-ohsung-rental` 전용입니다. 같은 Emulator 세션에서 테스트 계정 비밀번호를 변경했다면 Emulator를 다시 시작한 뒤 시드를 실행하세요.

```sh
npm test                  # 독립적인 Auth·Firestore Emulator를 실행하므로 위 Emulator를 먼저 종료
npm run lint
npm run build:demo        # 로컬 설정 없이 정적 빌드 확인
npm audit
npm audit --omit=dev
```

`npm run build:release`는 Firebase 웹 설정 네 값이 준비된 경우에만 실행합니다. 값이 비어 있으면 빌드 오류로 중단됩니다.

테스트는 동시 대여와 번호 등록, 비활성 물품의 반납, 권한 회수, 학생 계정 발급 및 50건 이상 이력의 커서 조회를 가상 데이터로 검증합니다. `npm test`는 전체 테스트를 실행하며 학생 계정 발급 테스트도 포함합니다. 이번 배포 패키지 검증에서는 발급 스크립트를 불러오는 그 테스트 파일을 실행하지 않습니다. 테스트 코드는 그대로 유지하며, 전체 테스트는 나중에 격리된 Emulator에서 가상 계정만으로 실행할 수 있습니다.

## 서비스 시작 전 한 번 설정

1. Firebase Spark 프로젝트에 웹 앱을 등록하고, Cloud Firestore Standard 기본 데이터베이스를 프로덕션 모드로 만듭니다.
2. Authentication에서 **이메일/비밀번호**를 활성화합니다. 배포한 Pages 호스트를 **승인된 도메인**에 등록합니다. 관리자가 이메일 재설정을 사용하려면 비밀번호 재설정 템플릿을 확인합니다. 학생의 내부 별칭 도메인을 DNS 또는 승인된 도메인에 등록할 필요는 없습니다. Firebase의 계정 열거 보호 설정도 확인합니다. [Firebase 이메일/비밀번호 인증](https://firebase.google.com/docs/auth/web/password-auth)
3. [`firestore.rules`](firestore.rules)와 [`firestore.indexes.json`](firestore.indexes.json)을 대상 프로젝트에 적용하고 복합 인덱스가 준비될 때까지 기다립니다.
4. 관리자 계정을 준비한 뒤 [물품 번호 마이그레이션](#기존-재고-마이그레이션)을 완료합니다. 이후 관리자 콘솔에서 운영 재고를 등록합니다. 관리자는 등록 이메일의 비밀번호 재설정 링크로 첫 비밀번호를 설정할 수 있습니다.

| 경로 | 등록할 필드 |
| --- | --- |
| `users/{관리자 Auth UID}` | `name` 문자열 (최대 80자) |
| `roles/{관리자 Auth UID}` | `admin` 불리언 `true` |

Firebase 웹 앱 설정값 네 개는 [`frontend/.env.example`](frontend/.env.example)을 참고해 `frontend/.env.local` 또는 호스팅 플랫폼의 환경변수에 넣습니다. Firebase 웹 설정은 브라우저 번들에서 누구나 볼 수 있는 공개 설정입니다. 인증과 데이터 접근을 보호하는 기준은 Firebase Authentication 및 Firestore Security Rules입니다. Admin SDK 서비스 계정 JSON, 비공개 키, 관리자 비밀번호 같은 서버 자격 증명은 `VITE_*` 변수나 정적 파일에 넣지 않습니다. [Firebase 웹 API 키 안내](https://firebase.google.com/docs/projects/api-keys) · [Firebase 이메일 인증 문서](https://firebase.google.com/docs/auth/web/password-auth)

### 학생 ID 로그인 방식

학생은 숫자 7자리의 **학생 ID와 개인 비밀번호**를 사용합니다. 앱은 Firebase Authentication을 호출할 때만 이를 `2610710@students.ohsung-rental.invalid` 형태의 내부 별칭으로 바꿉니다. `.invalid`는 메일 수신용 DNS 도메인이 아닙니다. 학생의 초기 비밀번호는 운영자가 개별적으로 전달하고, 분실 시에는 학생회가 본인을 확인한 뒤 초기화할 수 있도록 운영합니다. 관리자는 같은 로그인 화면에 등록된 이메일을 입력하며, 이메일 입력 시 비밀번호 재설정 버튼을 사용할 수 있습니다. [예약된 DNS 이름](https://www.rfc-editor.org/info/rfc2606/)

신규 학생의 Auth UID는 7자리 학생 ID 문자열 그대로 사용합니다. 예를 들어 `0012345`는 숫자 `12345`가 아니라 UID `0012345`입니다. 같은 UID가 `users/{uid}` 문서와 대여의 `userId` 참조에 사용됩니다. 기존 도구가 프로젝트와 학생 ID에서 계산한 해시 UID로 발급한 학생은 현재 UID와 대여 참조를 유지합니다. 발급 도구는 그 해시 UID에 Auth 계정이나 프로필이 있으면 새 UID로 중복 발급하지 않고 중단합니다. 계정이나 대여 이력을 자동 이전하지 않으므로 기존 학생의 UID 변경은 별도 검토와 이전 계획이 필요합니다. 기존 `users/{uid}`에 이름과 학생 ID를 두고 학년은 필요한 경우에만 1~3의 정수로 저장합니다. 비밀번호와 해시는 Firebase Authentication에 맡깁니다.

Firestore 권한은 로그인 성공, 발급 도구가 설정한 Auth의 `student_id` 클레임 및 별칭, 해당 UID의 활성 프로필이 모두 일치할 때 부여합니다. 준비 중인 프로필은 접근을 막습니다. 학생은 본인 프로필만 읽을 수 있고, 계정과 프로필·관리자 권한의 쓰기는 운영자 전용입니다. 예전 이메일 전용 프로필은 신뢰된 관리자 역할이 있는 경우 계속 사용할 수 있습니다. 학생에게 기존 Auth 계정이 있으면 정식 오픈 전에 운영자가 UID와 대여 이력을 확인해 이전 여부를 결정해야 합니다. 이번 코드에서는 기존 계정·이력·비밀번호를 자동으로 이전하지 않습니다. [Firebase 커스텀 클레임](https://firebase.google.com/docs/auth/admin/custom-claims)

별칭의 유일성은 Firebase Auth가 확인합니다. 공개 Auth API로 미리 같은 별칭을 등록한 계정도 발급 클레임과 승인 프로필이 없어 대여 기능을 이용할 수 없습니다. 발급 도구는 해당 충돌을 표시하고 기존 계정을 가져오지 않습니다. 학생 ID를 UID로 쓰므로 ID가 UID와 대여 참조에 포함됩니다. 기존 계정의 ID를 바꿀 때는 UID와 대여 참조를 그대로 두고 별칭·클레임·프로필을 함께 갱신해야 하며, 새 ID로 계정을 자동 발급하지 않습니다. 별도 맞춤 인증 서버는 입력과 복구 정책을 더 유연하게 할 수 있지만, 서버 운영과 추가 권한 관리가 필요합니다. 현재 방식은 기존 정적 호스팅과 Firebase Spark 구성에서 별도 서버 없이 동작합니다.

### 학생 계정 발급

아래 명령은 향후 계정 발급을 위한 절차입니다. 이번 배포 패키지 작업에서는 학생 명단을 사용하거나 계정을 만들지 않으며, 실제 데이터 이관도 하지 않습니다.

명단은 Git 저장소 바깥의 JSON 파일로 준비합니다. 아래 값은 가상 예시입니다.

```json
[
  { "studentId": "2610710", "name": "가상 학생", "grade": 1 },
  { "studentId": "0012345", "name": "가상 학생 B" }
]
```

학생 ID와 이름만 필수입니다. `frontend`에서 먼저 로컬 파일을 검사합니다. 기본 명령은 형식과 중복을 검사하며 Firebase에 쓰지 않습니다.

```sh
npm run students:provision -- "$HOME/students.local.json"
```

가상 계정으로 검증할 때는 Auth·Firestore Emulator를 띄운 상태에서 실행합니다.

```sh
npm run students:provision -- "$HOME/students.local.json" --emulator --apply --credentials-out "$HOME/students.credentials.json"
```

향후 운영 등록을 할 때는 Firebase Authentication Admin과 Cloud Datastore User 권한이 있는 운영자 ADC를 사용합니다. 자격 증명 파일이 필요하면 저장소 바깥에서 관리합니다. [ADC 설정](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment) · [Firebase Admin 인증](https://firebase.google.com/docs/admin/setup#initialize_the_sdk_in_non-google_environments)

```sh
npm run students:provision -- "$HOME/students.local.json"   --project FIREBASE_PROJECT_ID --apply --credentials-out "$HOME/students.credentials.json"
```

발급 결과 파일은 본인만 읽고 쓸 수 있도록 생성됩니다. 여기에 개인별로 생성된 초기 비밀번호가 있으므로 명단, 코드, 채팅 기록, 공용 저장소와 분리합니다. 성공이 확인된 학생에게만 해당 비밀번호를 개별 전달합니다. 중단 후에는 같은 프로젝트·명단·결과 파일로 재실행합니다. 기존 계정의 비밀번호나 관리자 역할은 일괄 등록으로 덮어쓰지 않습니다. 발급 경로는 Admin SDK를 사용하는 로컬 도구에 한정됩니다.

## 관리자 콘솔과 물품 관리

관리자 계정으로 로그인하고 **관리자 콘솔**을 엽니다.

- **대여 현황**에서 진행 중, 승인 대기, 연체를 골라 보거나 학생 이름·물품명·물품 번호로 검색합니다. 승인 대기 전환과 반납 승인은 별개입니다.
- **물품 관리**에서 카테고리, 물품명, 번호, 사용 여부를 저장합니다. 번호는 1~9999 정수입니다. 같은 카테고리의 번호는 사용 중지된 물품까지 포함하여 하나만 배정할 수 있습니다. 대여·반납 중에는 사용 여부만 변경할 수 있고, 반납 승인은 계속 가능합니다.
- **운영 요약**은 Firestore 집계로 전체 등록, 대여 가능, 대여 중, 승인 대기, 연체 건수를 표시합니다. 카테고리를 선택하면 해당 재고만 집계합니다. 연체는 서버에서 확인한 시각과 서버가 기록한 대여 시각을 기준으로 계산합니다. 제품과 대여 건수의 개별 집계는 동시 작업 중 서로 다른 읽기 시점일 수 있습니다.

검색은 **정확히 일치**하는 값에 적용됩니다. 이전·다음 이동은 쿼리의 정렬값과 문서 ID를 커서로 삼아 한 번에 20건씩 가져옵니다. 검색이나 필터를 바꾸면 첫 페이지로 이동합니다. 여러 페이지를 보는 사이 다른 작업이 검색 조건이나 정렬값을 바꾸면 결과가 움직일 수 있으므로 최신 결과는 다시 조회합니다. 학생 **내 페이지**의 상태별 건수는 현재 페이지의 행 수와 분리해 집계합니다.

### 기존 재고 마이그레이션

물품의 ID는 유지합니다. `productNumbers/{카테고리|번호}` 문서가 각 물품을 가리키며, 새 등록과 카테고리·번호 변경은 예약 문서와 한 트랜잭션에 들어갑니다. Firestore 규칙은 두 문서의 변경을 함께 검증합니다. 카테고리는 앞뒤 공백을 정리한 정확한 문자열을 기준으로 하며, 경로 구분자로 쓰이는 `/`와 `|` 및 제어 문자는 허용하지 않습니다.

기존 물품은 `isEnabled`가 빠져 있으면 사용 가능으로 취급합니다. 이 필드는 대여 상태와 독립적입니다. 프로그램은 이전 물품 ID와 대여 연결을 유지하면서 번호 예약과 누락된 `isEnabled`를 채웁니다. 진행 중인 구형 대여의 이름 검색을 위해 기존 프로필이 있는 경우에만 `borrowerName`을 채웁니다. 이미 완료된 과거 이력은 유지합니다. 새 대여의 `borrowerName`은 규칙에서 본인의 프로필과 대조하며, 대여 시점 물품명과 번호도 이력에 보존됩니다. 이름 스냅샷이나 프로필이 없는 구형 대여는 이름 검색에서 제외되며, 물품명이나 번호로 찾을 수 있습니다.

마이그레이션은 새 규칙을 적용한 다음 한 명의 운영자가 점검 시간에 실행합니다. 검사와 적용 사이에는 대여·반납 및 콘솔에서의 직접 재고 수정을 잠시 멈춰 일관된 재고를 검증합니다. 기본 모드는 읽기 전용 검사이며, 중복 번호나 불일치가 있으면 우선 해당 재고를 확인합니다. 빈 데이터베이스도 준비 완료 표식 없이 신규 등록이 잠겨 있으므로 초기 설정 때 실행합니다.

```sh
# frontend 폴더에서 권한이 있는 운영자 ADC 사용
npm run inventory:migrate -- --project FIREBASE_PROJECT_ID
npm run inventory:migrate -- --project FIREBASE_PROJECT_ID --apply

# 또는 가상 데이터 전용 로컬 Emulator
npm run inventory:migrate -- --emulator
npm run inventory:migrate -- --emulator --apply
```

운영 모드의 `--apply`는 기존 문서를 검증하고 필요한 번호 예약과 필드만 기록합니다. 모두 끝나면 `inventorySettings/v1`에 준비 완료를 설정합니다. 작업이 중단되면 약속된 점검 시간을 유지하고 같은 명령으로 다시 검사합니다. 준비 후에는 관리자 콘솔로 새 물품을 등록해 예약과 재고가 함께 변경되도록 합니다. 물품을 계속 참조하는 대여 기록을 보존하기 위해 영구 삭제 대신 사용 중지를 제공합니다.

구버전 페이지가 열려 있으면 새 대여에 필요한 이름 스냅샷이 전송되지 않을 수 있습니다. 규칙과 새 정적 빌드를 같은 점검 시간에 반영하고 학생이 페이지를 새로 열어 사용하도록 안내합니다.

## 정적 배포

프로덕션 앱을 빌드할 때는 `frontend`를 작업 디렉터리로 두고 `npm ci && npm run build:release`를 실행합니다. 네 가지 Firebase 웹 설정 중 하나라도 없거나 프로젝트 ID가 `demo-`로 시작하면 빌드가 오류를 내고 중단됩니다. 출력 디렉터리는 `frontend/dist`이며 브라우저에서 실행하는 정적 파일만 담습니다. Vite의 `base: './'`와 `HashRouter`를 사용해 앱 경로가 `/#/Borrow` 또는 `/ohsung-rental/#/Borrow` 형태입니다. 직접 주소 열기와 새로고침에 서버 리라이트가 필요 없고 HTTPS 호스트에서 동작합니다.

`npm run build:demo`는 가상 데이터용 화면 빌드입니다. 데모 빌드에는 Firebase 운영 설정이 들어가지 않으며 운영 데이터에 연결되지 않습니다. 로컬에서 함께 제공된 `ohsung-rental-demo-dist`는 이 가상 데이터 빌드입니다. 운영 사이트에 올릴 `dist`는 실제 Firebase 웹 설정을 배포 환경에 넣은 뒤 생성합니다. `frontend/scripts/`의 Admin SDK 기반 관리 도구, Emulator 설정, 테스트는 정적 배포 artifact에 포함되지 않습니다.

### Cloudflare Pages

| 설정 | 값 |
| --- | --- |
| Root directory (루트 디렉터리) | `frontend` |
| Build command (빌드 명령) | `npm ci && npm run build:release` |
| Build output directory (출력 디렉터리) | `dist` |
| Node.js version | `NODE_VERSION` 환경변수에 `24.22.3` |
| Dependency installation | `SKIP_DEPENDENCY_INSTALL=1` |
| Firebase 웹 설정 | 아래의 네 변수 모두 설정 |

Cloudflare Pages 환경변수에 다음 키를 등록합니다. 이 값들은 브라우저 번들에 포함되는 공개 Firebase 웹 설정입니다.

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
```

`SKIP_DEPENDENCY_INSTALL=1`은 Cloudflare Pages의 자동 종속성 설치만 건너뜁니다. 빌드 명령 안의 `npm ci`가 lockfile 기준으로 종속성을 설치한 뒤 프로덕션 빌드를 실행합니다. 데모 배포를 선택한다면 빌드 명령을 `npm ci && npm run build:demo`로 바꾸고, 해당 주소를 운영 서비스로 안내하지 않습니다. Git 연결 없이 배포할 때는 로컬의 `frontend/dist`를 Cloudflare Pages Direct Upload에 지정합니다. [Cloudflare 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Cloudflare 빌드 이미지 환경변수](https://developers.cloudflare.com/pages/configuration/build-image/) · [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

### GitHub Pages

대상은 [oshs-20th-sc/ohsung-rental](https://github.com/oshs-20th-sc/ohsung-rental)입니다.

GitHub Pages에서 배포할 때는 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다. 이 저장소의 [수동 실행 워크플로](.github/workflows/pages.yml)는 기본 브랜치에 `workflow_dispatch`로 시작하며, push나 pull request에서 자동 배포하지 않습니다. GitHub의 **Settings → Secrets and variables → Actions → Variables**에 앞의 `VITE_FIREBASE_*` 네 값을 등록한 뒤 **Actions → Deploy GitHub Pages → Run workflow**를 선택합니다. 빌드 작업은 `frontend`에서 `npm ci` 및 `npm run build:release`를 실행하고, `frontend/dist`만 Pages artifact로 전달합니다. 주소는 `https://oshs-20th-sc.github.io/ohsung-rental/` 형태입니다. Firebase Authentication의 승인된 도메인에는 `oshs-20th-sc.github.io`를 등록합니다.

[GitHub Pages 사용자 지정 워크플로 문서](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

### Firebase 규칙과 인덱스

호스팅 빌드는 Firebase Rules나 인덱스를 변경하지 않습니다. 신뢰할 수 있는 개발 환경에서 `frontend`의 종속성을 설치하고 규칙과 인덱스를 검토합니다. 배포할 때는 저장소 루트에서 대상 Firebase 프로젝트를 명시해 별도로 실행합니다. 다음 예시의 `YOUR_FIREBASE_PROJECT_ID`는 설명용 자리표시자이며 그대로 실행하지 않습니다. 이번 패키지 작업에서는 Firebase 프로젝트에 배포하지 않습니다.

```sh
./frontend/node_modules/.bin/firebase deploy --only firestore:rules,firestore:indexes --project YOUR_FIREBASE_PROJECT_ID
```

Rules 배포는 프로젝트의 현재 Firestore 규칙을 교체하므로, 실제 프로젝트 ID를 입력하기 전에 운영 프로젝트의 현재 규칙과 이 저장소의 `firestore.rules` 차이를 확인하고 변경을 승인받으세요. 인덱스는 `firestore.indexes.json`에서 생성됩니다. 콘솔이나 CLI에서 활성 복합 인덱스가 `READY`가 될 때까지 기다린 후 서비스 사용을 시작합니다. Firebase Admin SDK와 계정 발급 도구는 신뢰된 로컬 또는 서버 환경에서만 사용하며, GitHub Pages나 Cloudflare의 프런트엔드 번들에 포함되지 않습니다.

## 보안과 운영

- Firebase 사용자 등록과 앱 가입 허용을 분리했습니다. Auth UID에 해당하는 `users` 문서가 있어야 앱 데이터에 접근하며, `roles`의 관리자 지정은 신뢰할 수 있는 콘솔 작업으로 관리합니다.
- 대여와 반납의 각 전환은 물품과 대여 기록을 하나의 트랜잭션으로 변경합니다. Rules가 두 문서의 변경 전후 상태, 소유자, 타임스탬프와 수정 필드를 검증합니다. 학생은 자신의 기록만 읽고 반납을 신청하며, 관리자가 별도로 승인합니다.
- 연체 기한은 Firestore가 기록한 대여 시각에서 48시간입니다. 화면은 기기에 저장된 현재 시각으로 잔여 시간을 표시합니다. 학생의 신청 가능 여부는 Firestore가 `request.time`으로 판정합니다. 관리자는 기존 흐름대로 대여 중이거나 연체된 물품을 승인 대기로 옮길 수 있습니다.
- 핵심 기능은 Spark의 기본 Authentication 및 Firestore 기능을 사용합니다. Rules의 교차 문서 읽기도 할당량에 포함됩니다. 정식 운영 전 계정 발급·회수, 관리자 콘솔 접근 권한, 읽기 할당량과 데이터 보관 정책을 검토해야 합니다. [Firestore 할당량 및 과금](https://firebase.google.com/docs/firestore/pricing)
- 자동 알림이나 유료 관리형 백업은 현재 범위에 포함되지 않습니다. 향후 신뢰 가능한 예약 작업이 필요하면 Cloud Functions 등 서버 측 실행 환경과 요금제를 별도로 검토합니다.

### 이용 권한 회수와 개인정보 정리

일시 중지하거나 계정을 폐기할 때 신뢰할 수 있는 Firebase 운영자가 `roles/{uid}`를 먼저 제거하고 학생 프로필에 `isActive: false`를 설정하거나 필요한 경우 `users/{uid}` 회원 문서를 제거합니다. Firebase Auth에서는 계정을 비활성화하고 기존 갱신 토큰을 철회합니다. Rules는 매번 회원과 관리자 권한을 확인하고, 화면은 회원·권한 문서 변경을 구독합니다. 진행 중인 대여가 있으면 관리자가 반납을 마무리할 수 있으며, 계정 권한을 중지해도 대여 이력은 자동 삭제되지 않습니다.

보관 기간이 지난 개인정보와 대여 이력의 보관 여부는 운영자가 학교 기준에 따라 결정합니다. 이름 스냅샷도 개인정보에 포함됩니다. 정리할 때는 권한 있는 도구로 필요한 이름·계정 식별자만 익명화하는 절차를 승인하고, 상품 ID 및 대여 상태 연결을 검증합니다. Auth 계정의 삭제와 보존 데이터의 정리는 운영자가 별도 작업으로 처리합니다.

후속 관리자 계정 관리 기능은 관리자 인증과 권한 검증을 거친 신뢰 가능한 서버나 운영자 도구에서 발급 로직을 재사용합니다. 기존 학생의 ID를 수정할 때는 현재 UID와 대여 참조를 보존한 채 별칭·클레임·프로필을 함께 변경합니다. 신규 학생 발급 UID는 입력한 7자리 ID 문자열과 일치해야 합니다. 비밀번호를 초기화할 때는 본인 확인 후 Admin SDK로 개인별 임시 비밀번호를 설정하고 기존 갱신 토큰을 철회합니다. 브라우저에 Admin SDK 자격 증명을 배포하지 않습니다. [Firebase 세션 관리](https://firebase.google.com/docs/auth/admin/manage-sessions)

### 배포 소스 패키지의 경계

이 디렉터리는 기존 작업 폴더와 분리된 정적 배포용 소스입니다. 저장소에 올릴 파일은 이 디렉터리 안에서만 검토합니다. 원래 작업 폴더의 `.git` 기록은 가져오지 않습니다.

다음 파일은 배포 소스 또는 정적 artifact에 포함하지 않습니다.

- Flask·MySQL 백엔드, 서버 설정 및 기존 SQL 데이터. Firebase 기반 정적 배포에 필요하지 않으며 기존 데이터를 그대로 보존합니다.
- 학생 명단 Excel/CSV, 학생 개인정보와 비밀번호·해시. 승인된 계정 발급 단계에서만 다룹니다.
- Firebase 서비스 계정 JSON, Admin SDK 자격 증명, 서버 인증정보와 `.env.local`. 해당 환경 안에서만 관리합니다.
- 기존 `.git`과 커밋 기록. 새 저장소로 기존 파일 이력을 가져오지 않습니다.
- `node_modules`, 캐시·로그·임시 파일과 화면에서 참조하지 않는 이미지. 필요한 패키지는 잠금 파일로 다시 설치하고 화면에서 사용하는 정적 리소스만 제공합니다.

저장소에 두는 `frontend/.env.example`은 형식 안내용 자리표시자입니다. 실제 설정값은 로컬 `.env.local` 또는 호스팅의 변수 저장소에 따로 넣습니다. 웹 Firebase 설정은 공개값이므로 이 설정만으로 권한을 부여하지 말고 Rules를 적용하고 Firebase Authentication 승인 도메인을 제한합니다. Admin SDK를 사용하는 발급·마이그레이션 스크립트는 로컬 운영 도구로 유지되며 브라우저 번들에 들어가지 않습니다.

잠금 파일에는 Firestore의 `@grpc/grpc-js`와 Firebase CLI의 일부 전이 의존성에 대한 검증된 버전 조정이 포함되어 있습니다. 전체 의존성과 배포 의존성은 `npm audit` 및 `npm audit --omit=dev`로 각각 확인합니다.

### 실제 계정 발급 전에 확인할 일

학생 계정 발급은 별도 후속 작업입니다. 학교에서 승인한 최신 학번·이름 자료의 취급 방식, 계정 발급 담당자와 권한 회수 담당자, 본인 확인과 비밀번호 초기화 절차, 기존 대여 이력과 계정의 연결 정책을 정합니다. 먼저 가상 데이터만으로 Emulator 발급 및 복구 절차를 검증하고, 운영 관리자 계정과 Firestore Rules를 검토합니다. 실제 명단을 저장소나 빌드 artifact에 두지 않으며, 계정 발급 명령은 승인된 작업 계획에 따라 신뢰 가능한 환경에서 별도로 실행합니다. 이번 배포 패키지 작업에서는 학생 계정이나 Firebase 운영 데이터를 변경하지 않았습니다.
