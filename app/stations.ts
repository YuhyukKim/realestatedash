export type NearbyStation = {
  name: string;
  lines: string;
  distanceMeters: number;
  walkMinutes: number;
};

const station = (name: string, lines: string, distanceMeters: number): NearbyStation => ({
  name,
  lines,
  distanceMeters,
  walkMinutes: Math.max(4, Math.round(distanceMeters / 65)),
});

const DISTRICT_STATIONS: Record<string, NearbyStation[]> = {
  도봉구: [station("창동", "1·4호선", 400), station("쌍문", "4호선", 850), station("녹천", "1호선", 900)],
  노원구: [station("노원", "4·7호선", 500), station("중계", "7호선", 800), station("하계", "7호선", 900)],
  금천구: [station("금천구청", "1호선", 850), station("독산", "1호선", 900), station("석수", "1호선", 1100)],
  중랑구: [station("신내", "6호선·경춘선", 700), station("봉화산", "6호선", 900), station("망우", "경의중앙선·경춘선", 1100)],
  강북구: [station("미아사거리", "4호선", 500), station("미아", "4호선", 800), station("수유", "4호선", 1000)],
  구로구: [station("오류동", "1호선", 450), station("개봉", "1호선", 800), station("천왕", "7호선", 1100)],
  은평구: [station("녹번", "3호선", 450), station("불광", "3·6호선", 800), station("응암", "6호선", 900)],
  성북구: [station("길음", "4호선", 450), station("성신여대입구", "4호선·우이신설선", 900), station("미아사거리", "4호선", 1100)],
  동대문구: [station("청량리", "1호선·경의중앙선·경춘선·수인분당선", 650), station("회기", "1호선·경의중앙선", 950), station("답십리", "5호선", 1000)],
  광진구: [station("광나루", "5호선", 500), station("아차산", "5호선", 850), station("구의", "2호선", 1000)],
  강서구: [station("마곡나루", "9호선·공항철도", 450), station("마곡", "5호선", 800), station("발산", "5호선", 950)],
  관악구: [station("봉천", "2호선", 500), station("서울대입구", "2호선", 850), station("신림", "2호선", 1000)],
  영등포구: [station("신길", "1·5호선", 500), station("보라매", "7호선·신림선", 800), station("대방", "1호선·신림선", 950)],
  마포구: [station("공덕", "5·6호선·경의중앙선·공항철도", 400), station("대흥", "6호선", 800), station("애오개", "5호선", 900)],
  서대문구: [station("충정로", "2·5호선", 700), station("서대문", "5호선", 850), station("신촌", "2호선", 1000)],
  송파구: [station("가락시장", "3·8호선", 500), station("문정", "8호선", 850), station("경찰병원", "3호선", 950)],
  성동구: [station("왕십리", "2·5호선·경의중앙선·수인분당선", 600), station("서울숲", "수인분당선", 850), station("뚝섬", "2호선", 1000)],
  용산구: [station("이촌", "4호선·경의중앙선", 500), station("서빙고", "경의중앙선", 850), station("한강진", "6호선", 1100)],
  강동구: [station("고덕", "5호선", 500), station("상일동", "5호선", 850), station("명일", "5호선", 950)],
  양천구: [station("목동", "5호선", 500), station("오목교", "5호선", 800), station("신정", "5호선", 1000)],
  동작구: [station("흑석", "9호선", 450), station("노들", "9호선", 900), station("상도", "7호선", 1000)],
  종로구: [station("서대문", "5호선", 550), station("광화문", "5호선", 900), station("독립문", "3호선", 1000)],
  강남구: [station("강남", "2호선·신분당선", 500), station("역삼", "2호선", 800), station("선릉", "2호선·수인분당선", 1000)],
  서초구: [station("서초", "2호선", 500), station("교대", "2·3호선", 850), station("고속터미널", "3·7·9호선", 1100)],
};

const DONG_STATIONS: Record<string, NearbyStation[]> = {
  "노원구:월계동": [station("광운대", "1호선·경춘선", 650), station("석계", "1·6호선", 850), station("월계", "1호선", 900)],
  "마포구:대흥동": [station("대흥", "6호선", 400), station("공덕", "5·6호선·경의중앙선·공항철도", 750), station("광흥창", "6호선", 900)],
  "마포구:아현동": [station("애오개", "5호선", 400), station("아현", "2호선", 750), station("공덕", "5·6호선·경의중앙선·공항철도", 950)],
  "송파구:문정동": [station("문정", "8호선", 400), station("장지", "8호선", 800), station("가락시장", "3·8호선", 1000)],
  "송파구:잠실동": [station("잠실", "2·8호선", 400), station("잠실새내", "2호선", 850), station("종합운동장", "2·9호선", 1100)],
  "성동구:행당동": [station("행당", "5호선", 450), station("왕십리", "2·5호선·경의중앙선·수인분당선", 800), station("응봉", "경의중앙선", 1000)],
  "성동구:옥수동": [station("옥수", "3호선·경의중앙선", 400), station("금호", "3호선", 850), station("압구정", "3호선", 1100)],
  "성동구:성수동1가": [station("서울숲", "수인분당선", 450), station("뚝섬", "2호선", 700), station("성수", "2호선", 950)],
  "용산구:한남동": [station("한강진", "6호선", 500), station("이태원", "6호선", 850), station("옥수", "3호선·경의중앙선", 1200)],
  "강남구:역삼동": [station("역삼", "2호선", 400), station("강남", "2호선·신분당선", 850), station("선릉", "2호선·수인분당선", 1000)],
  "강남구:대치동": [station("대치", "3호선", 400), station("한티", "수인분당선", 800), station("도곡", "3호선·수인분당선", 1000)],
  "강남구:개포동": [station("개포동", "수인분당선", 450), station("대모산입구", "수인분당선", 800), station("구룡", "수인분당선", 950)],
  "강남구:압구정동": [station("압구정", "3호선", 450), station("압구정로데오", "수인분당선", 900), station("신사", "3호선·신분당선", 1100)],
  "강남구:청담동": [station("청담", "7호선", 450), station("압구정로데오", "수인분당선", 850), station("강남구청", "7호선·수인분당선", 1000)],
  "서초구:잠원동": [station("잠원", "3호선", 450), station("반포", "7호선", 850), station("고속터미널", "3·7·9호선", 1000)],
  "서초구:반포동": [station("고속터미널", "3·7·9호선", 400), station("신반포", "9호선", 750), station("반포", "7호선", 950)],
  "서초구:서초동": [station("서초", "2호선", 400), station("교대", "2·3호선", 750), station("남부터미널", "3호선", 1000)],
  "종로구:평동": [station("서대문", "5호선", 400), station("광화문", "5호선", 800), station("독립문", "3호선", 1000)],
};

export function getNearbyStations(district: string, dong: string): NearbyStation[] {
  return DONG_STATIONS[`${district}:${dong}`] ?? DISTRICT_STATIONS[district] ?? [];
}
