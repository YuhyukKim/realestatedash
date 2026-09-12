# GitHub-only 운영

사이트: https://yuhyukkim.github.io/realestatedash/

## 구성

- 운영 소스·수집 데이터 브랜치: `main`
- 화면 호스팅: GitHub Pages
- 실거래 수집: GitHub Actions (방문자 브라우저에서 공공 API를 호출하지 않음)
- 데이터 보관: `data/scopes/<구 코드>/<YYYYMM>.<sale|rent>.json`
- Cloudflare 자동 빌드 연결은 해제하고 GitHub의 Cloudflare 배포 워크플로는 제거했다. 기존 Worker·D1·사이트는 삭제하지 않았다. 과거 설정은 Git 이력에서 복구 가능하다.

## 최초 설정

1. Settings → Pages → Source: **GitHub Actions**
2. Settings → Secrets and variables → Actions → Repository secrets:
   - `MOLIT_API_KEY`: 공공데이터포털 일반 인증키 (Decoding 권장; Encoding도 처리함)
   - 매매와 전월세 API 각각 활용 승인이 필요. 계정 인증키가 같으면 하나만 저장.
3. Repository variables:
   - `PAGES_PUBLISH_ENABLED=true`: 새 GitHub 공개 주소 게시를 승인한 후 활성화
   - `NAVER_MAP_CLIENT_ID` (선택): 공개 Maps Client ID. 네이버 콘솔에 `https://yuhyukkim.github.io` 웹 서비스 URL을 추가해야 한다. 비밀키가 아님.
4. `main` 브랜치 푸시 → 빌드·검증 성공 → Pages 게시
5. API 키, DATA_REFRESH_TOKEN, Cloudflare 토큰은 프런트엔드나 공개 파일에 넣지 않는다. DATA_REFRESH_TOKEN / PUBLIC_SITE_URL은 이 구성에서 사용하지 않는다.

## 수집

Actions → **Collect MOLIT snapshots** → Run workflow:

- **Branch: main** 을 선택.
- districts: 예 `마포구` 또는 `마포구,영등포구`
- from / to: 예 `202608` / `202609`
- kind: `sale`, `rent`, `both`
- 공란 기간: 전달~이번 달. 한 번에 최대 12개월, 총 150 구×월×유형 범위.
- 매매 2006년부터, 전월세 2011년부터. 오래된 이력은 소규모 구·기간별로 나누어 수집.
- 전체 수집 성공 → 데이터 검증·빌드 → 데이터 커밋 → 같은 실행에서 Pages 재배포.
- 일부 실패 / API 오류 / 불완전한 페이지 응답 / 기존 비어 있지 않던 범위가 갑자기 0건이면 실패 처리하고 공개 데이터를 유지.
- 정기 수집은 최초 검증 전 자동 활성화하지 않는다. 현 브랜치는 수동 수집만 제공한다.
- `GITHUB_TOKEN`의 데이터 푸시는 다른 push 워크플로를 실행하지 않으므로 수집 워크플로가 게시 워크플로를 직접 호출한다.
- 동시 코드 푸시와 충돌하면 자동 강제 푸시하지 않는다. 최신 소스로 수집을 재실행한다.

## 데이터 의미 / 제한

공식 단지 마스터 목록과 거래 수집 범위를 구분한다. 단지 좌표·공식 목록에도 미확인·누락 가능성이 있으며, 서울 전체 단지 완전 수록을 보장하지 않는다.
미수집 월은 거래 0건이 아니다. 성공한 빈 응답만 수집 완료 0건으로 인정한다.
미매칭 거래는 원본의 정제된 관측값 및 월별 통계에 보존하고 단지 팝업에는 임의로 연결하지 않는다.
취소·해제 매매는 파싱 시 제외하며, 해당 월 재수집으로 정정을 반영한다.
가격 요약은 조회 월까지 수집된 매매 중 면적별 최근 거래이고, 지도·역 거리는 기존 대표좌표 기반 추정, 학교는 2025년 파일 기반 주소 일치이며 배정학교가 아니다.

Pages 정적 데이터는 방문자가 다운로드할 수 있다. 계약일·가격·면적·층 등 공개 실거래 필드만 저장하고, 인증키·HTTP 요청·원문 응답·개인정보는 저장하지 않는다.
한 파일 40 MiB / 생성 JSON 총 450 MiB 초과 시 게시를 중단하도록 안전 한도를 둔다. 장기간·전 서울 대량 이력은 저장소 이력, 크기와 트래픽을 확인하고 별도 데이터 저장소로 확장해야 한다.
GitHub Pages 무료 제공·사용량·상업적 사용 제한은 공식 정책을 따른다. 현재 정보 제공용이며 광고/사업화를 본격화하기 전 정책 적합성과 호스팅 재검토가 필요하다.

## 검증·장애 대응

- `npm ci && npm run build:pages && npm run test:pages`
- `npx tsc --noEmit --incremental false`
- 배포물은 `dist-pages/`만 사용. Workers/server 빌드나 자격증명 디렉터리는 배포하지 않는다.
- 수집 실패: API별 승인 / 호출량 / 기간 확인. 키를 로그·이슈·대화에 붙이지 않는다.
- Pages 실패: Pages Source와 github-pages Environment 배포 브랜치 제한 확인.
- 이전 데이터 보존: 실패 실행의 임시 결과는 커밋하지 않는다. 정상 이전 커밋을 기준으로 복구 변경을 만들고 재게시한다.
- Naver 지도만 안 보이면 새 출처 등록과 Client ID 확인. 외부 지도 링크는 계속 제공한다.

참고: [Pages 사용자 정의 워크플로](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Pages 제한](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
