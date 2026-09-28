# 지도 건축물대장·최근 5개년 공시가격

`data/property/`는 서울 정비사업 지도의 공개 건축물·가격 스냅샷입니다. 소유자 정보나 인증키를 포함하지 않습니다.

2026-09-28에는 건축HUB 가격 API가 HTTP 429를 반환하여, 공식 대용량 공개 파일의 2026년 8월 말 자료로 전체 후보를 대조했습니다. 최신 전체 수집 결과는 `data/property/index.json`, 연도별 연결 호수와 미연결 상태는 `data/property/bulk-import.json`을 확인하세요. 과거 API 실패 기록인 `collection-run.json`과 혼동하지 마세요.

공식 원본: https://www.hub.go.kr/portal/opn/lps/idx-lgcpt-pvsn-srvc-list.do

- 표제부·전유부·전유공용면적·주택가격 네 자료를 같은 기준월로 확인합니다.
- 원본 파일 식별자·SHA-256·스키마는 `docs/audits/official-property-bulk-2026-08.json`에 기록합니다.
- 동·호수의 전유부 고유번호가 일치할 때만 가격을 연결합니다. 같은 이름만으로 연결하지 않습니다.
- 최근 5개년은 2022~2026년입니다. 원본에 없는 연도는 추정하지 않습니다.
- 기존 최신 API 가격과 이미 저장된 더 오래된 이력은 보존합니다.
- 수집 완료와 연결 성공을 구분합니다. 주소 미확인, 대장 불일치, 공개 가격 미수록은 별도 상태로 남깁니다.

재실행은 동일 기준월의 ZIP·공식 스키마를 작업 폴더에 준비한 뒤 종류별로 `python scripts/filter-official-property-bulk.py <폴더> <titles|expos|areas|prices> YYYYMM`을 실행하고, 네 완료 매니페스트가 생성되면 `node scripts/import-map-property-bulk.mjs <폴더> data/property`를 실행합니다. ZIP은 `hub-종류-YYYYMM.zip`, 스키마는 `schema-종류.json`입니다. 외부 원본이 바뀌면 스키마와 필지 검토도 다시 수행해야 합니다.

수집기 원본과 테스트는 별도 `seoul-redevelopment-map` 저장소에서 관리하며 이 저장소의 Node 수집기는 그 소스의 번들입니다. API 수집 워크플로는 계속 수동 실행 방식입니다. 현재 계정의 남은 호출량은 이 저장소에서 확인할 수 없습니다.
