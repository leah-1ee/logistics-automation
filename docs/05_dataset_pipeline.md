# 05. 실제 데이터와 재생 파이프라인

## 1. 원본과 사용 범위

원본: Brazilian E-Commerce Public Dataset by Olist

- 공식 제공 페이지: https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce
- 공개 설명 기준: 2016~2018년 실제 주문 약 10만 건.
- 정확한 주문·상품·상품 행 수는 다운로드한 원본에서 측정합니다. PRD의 대략적 수치를 실제 실행 검증값으로 사용하지 않습니다.
- MVP 파일: olist_orders_dataset.csv, olist_order_items_dataset.csv, olist_products_dataset.csv, olist_sellers_dataset.csv.
- 고객·결제·리뷰·위치 파일은 MVP 필수 입력이 아닙니다.
- 데이터 라이선스·다운로드 조건은 구현 시 원본 페이지에서 확인하고 manifest에 기록합니다. 문서 패키지에는 원본 데이터를 재배포하지 않습니다.

## 2. 실제·생성 데이터 구분

| 구분 | 실제 원본에서 사용하는 것 | 프로젝트에서 만드는 것 |
| --- | --- | --- |
| 주문 | 원본 orderId, source 상태, 승인·구매 시각 | 모의 API 공개 시각, 내부 주문 상태 |
| 상품 | productId, 카테고리, 중량·크기 등 존재하는 속성 | 표시용 축약 ID, QR 이미지 |
| 주문 상품 | 주문-상품-판매자 관계, 상품 행 | 집계한 requiredQty, 출고 작업 |
| 창고 | 원본에는 창고 작업 기록 없음 | 창고, 단말, 배정, 스캔, 보류, 완료 |
| 장애 | 실제 장애 기록 아님 | API 실패·중복·지연·순서 역전 시나리오 |
| 부하 | 실제 주문의 구조·분포 | 압축 재생 속도, 파생 ID, 동시 요청 수 |

원본 order_status가 delivered라고 해서 방금 만든 작업을 이미 완료한 것으로 표시하지 않습니다. 실제 배송 완료 시각을 서버의 현재 처리 결과로 사용하지 않습니다.

## 3. 준비 manifest

datasetVersion, downloadedAt, sourceUrl, licenseNotice, fileNames, fileSha256, fileBytes, rowCounts, distinctKeyCounts, schemaFingerprint, importConfigHash를 기록합니다.

운영 재생용 scenario manifest에는 datasetRunId, simulationClockAnchor, originalClockInterpretation, replaySpeed, orderingRule, filterVersion, adapterVersion, seed, faultPlanHash를 추가합니다.

같은 manifest로 두 번 실행한 정규화 결과와 작업 수가 같아야 합니다. 원본 해시가 다르면 다른 datasetVersion으로 취급합니다.

구현 보완: 주문 상품 distinct key는 order_id+order_item_id이며 주문 distinct 수와 별도입니다.
초기 합성 fixture manifest의 order_items distinctKeyCount=10은 order_id 기준의 10주문을
뜻하며 행 수 30과 구분합니다. 이후 준비 도구는 keyDefinition과 복합 key 수를 기록합니다.
누락/잘못된 sourceItemId는 source 계약에서 null로 전달하고 DATA_HOLD로 분류하며,
정확한 원문 값은 불변 CSV와 준비 인덱스 source_rows에서 복원합니다.

원본 규모 검증 보완(2026-10-28): 부모 주문 대사는 source_key 전용 인덱스를 사용합니다.
중량·치수의 결측/비양수/비정상 숫자는 상품 품질 flag로 보존하고, 상품 ID·수량이
유효한 작업을 그 사유만으로 제외하지 않습니다. 최초 대사가 전수 반복 탐색하던
미완료 준비 인덱스는 보존하고, 새 출력 파일로 재준비했습니다.

## 4. 필드 매핑

| 원본 | 내부 사용 | 규칙 |
| --- | --- | --- |
| orders.order_id | sourceOrderId | 원본 key 보존 |
| orders.order_status | sourceStatus | 과거 원본 상태. 내부 업무 상태와 별도 |
| orders.order_purchase_timestamp | sourcePurchasedAtRaw | 원문 문자열 보존 |
| orders.order_approved_at | sourceApprovedAtRaw | 작업 재생의 적격 판단·가상 순서 |
| order_items.order_id | 주문 연결 | 부모 주문 존재 확인 |
| order_items.order_item_id | 원본 상품 행 식별 | **수량 필드가 아님** |
| order_items.product_id | 상품 연결 | products 존재 확인 |
| order_items.seller_id | 판매자 연결 | 원본 판매자·관계 보존 |
| order_items.shipping_limit_date | sourceShipByRaw | 후속 우선순위 실험용. 물류 SLA로 단정하지 않음 |
| products.product_category_name | category | nullable 허용 |
| products.product_weight_g | weightG | 단위 보존, 음수·비정상 값은 품질 표시 |
| products.product_length_cm 등 | dimensionsCm | 단위 보존. 스캔 작업 필수 조건은 아님 |

원본 상품 행마다 상품 1개로 세고, 같은 orderId/productId의 행 수를 requiredQty로 집계합니다. order_item_id의 최대값을 상품 수량으로 쓰지 않습니다. 같은 product가 다른 seller에서 온 주문은 MVP의 다중 판매자 제외 기준을 먼저 적용합니다.

## 5. 분류 기준

전체 원본 주문은 모두 RECEIVED 원본으로 보존한 뒤 다음처럼 분류합니다.

| 분류 | 예시 | 작업 생성 |
| --- | --- | --- |
| READY | 원본 상태가 approved/processing/shipped/delivered 중 하나, 승인 시각 존재, 양수 상품 행·부모 관계 정상, 단일 판매자 | 가능 |
| DATA_HOLD | 필수 key 누락, 상품 행 없음, 부모 상품 부재, 같은 원본 key에 상충 내용 | 불가 |
| UNSUPPORTED | 원본 취소·unavailable·그 외 미지원 상태, 다중 판매자 | 불가 |

복수 원인이 있으면 모든 품질 flag를 보존하고 분류 우선순위는 DATA_HOLD → UNSUPPORTED → READY입니다. 단순 파일 조인 실패가 다중 판매자 제외로 가려지면 안 됩니다.

카테고리·중량·크기 결측은 별도 품질 flag이며 현장 상품 ID/수량 작업을 불필요하게 제외하지 않습니다. 적격 필터가 바뀌면 filterVersion을 변경하고 기존 시험과 구분합니다.

수집 raw의 같은 key/같은 해시는 재수집입니다. 같은 key/다른 해시는 자동 덮어쓰지 않고 원본 변경 충돌로 보존합니다. sourceRecordId는 정상 주문에서는 원본 orderId, key가 없는 오류 행에서는 파일 해시와 행 번호로 만든 안정적인 값입니다. 변경 주문의 운영 반영은 E1의 revision·변경 정책에서 다룹니다.

## 6. 재생 시계와 모의 외부 API

Olist의 offset 없는 원본 시각을 임의로 실제 UTC 발생 시각이라고 단정하지 않습니다. 원문은 보존하고, 내부 재생에서는 문서화된 가상 시계로 매핑합니다.

기본 순서: sourceApprovedAtRaw가 있으면 그 값, 없으면 sourcePurchasedAtRaw, 같은 시각은 orderId 사전순입니다. 이 정렬은 데이터셋 내부의 재현용 순서입니다.

- sourceAvailableAt: 원본 정렬 시각의 차이를 재생 시작 시각에 replaySpeed로 매핑한 값.
- scenarioNow 이전에 공개된 레코드만 모의 API가 반환합니다.
- 과거 주문 이력 중 일부 시각만 있으므로 실제 모든 이벤트 로그를 복원했다고 표현하지 않습니다.
- cursor는 datasetRunId·정렬 위치·시나리오 해시에 묶은 opaque token입니다.
- 같은 cursor 재요청은 같은 페이지와 nextCursor를 반환합니다.
- 다음 공개 시각이 아직 안 왔으면 빈 페이지, 같은 cursor, nextPollAfterMs를 반환합니다. 빈 페이지를 영구 EOF로 오해하지 않습니다.
- replay가 끝난 경우 exhausted=true입니다.
- datasetRunId나 filter/seed를 바꾼 커서는 409 CURSOR_RUN_MISMATCH입니다.

## 7. 수집 처리

원본 준비 단계에서 products 파일을 먼저 스트리밍 적재해 상품 master를 만듭니다. sellers와 order_items도 파일 해시·행 위치를 추적할 수 있게 보관합니다. 모의 주문 API는 준비된 파일을 조인한 주문/상품 행을 제공하고, 서버는 이미 적재한 master와 대조합니다. 따라서 상품 master의 초기 파일 적재와 주문 REST 수집을 결과 보고서에서 구분합니다.

1. 단일 수집 job이 해당 datasetRun의 checkpoint를 읽습니다.
2. limit 200의 페이지를 요청합니다. 이 값은 초기 설정이며 성능 측정으로 조정합니다.
3. 원본을 검증·보관하고 적격 주문을 정규화합니다.
4. READY 주문의 CREATE_TASK outbox를 기록합니다.
5. 해당 페이지 보관과 checkpoint를 일관되게 커밋합니다.
6. 다음 페이지로 넘어갑니다. Redis 장애는 outbox 처리 지연으로 보이고 원본 수집 결과를 잃지 않습니다.

한 배치가 실패하면 그 페이지를 다시 요청합니다. checkpoint를 DB 저장보다 먼저 진행하지 않습니다. 전체 CSV/전체 API 응답을 메모리에 올리는 방식은 기본 경로가 아닙니다.

## 8. 전체 데이터 대사

- 정상 key 원본 distinct 주문 수 + key 없는 오류 레코드 수 = 내부 raw_orders 수. 중복 원본 행은 원본 manifest/행 추적으로 별도 보고합니다.
- 내부 current 주문 분류 READY/TASK_CREATED + DATA_HOLD + UNSUPPORTED = raw_orders 수.
- 워커 drain 후 적격 current 주문 수 = tasks 수.
- 각 작업의 requiredQty = 해당 원본 주문·상품 행 수.
- CONFIRMED는 서버 적용된 순수 스캔 수량과 requiredQty가 모두 같은 작업뿐입니다.
- 집계 수량은 CONFIRMED task_items의 수량 합과 같습니다.

원본 행 수, distinct key, 정규화 revision 수, 작업 수, HTTP 요청 수, 스캔 event 수는 서로 다른 값입니다.

## 9. 실제 현장 시연

데이터셋에 등장하는 실제 상품을 구하기 어려우므로 시연 물건·카드에 원본 productId의 프로젝트 QR을 부착할 수 있습니다. 이때 실제 상품 인식이 아니라 **원본 상품 ID를 사용한 작업 입력·검증 시연**이라고 설명합니다.

실제 보드 스캔 실험과 소프트웨어 대량 재생은 결과 보고서에서 따로 기록합니다.

## 10. 추가 데이터 도입

실재고·수리·반품·배송사 이벤트·일련번호를 추가할 때는 출처·사용 범위·결측·라이선스·합성 여부를 별도 manifest에 기록합니다. 서로 무관한 공개 데이터셋을 주문 ID가 대응되는 것처럼 합치지 않습니다.
