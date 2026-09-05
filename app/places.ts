import type {
  NearbySchool,
  PlacesResponse,
  SchoolLevel,
} from "./place-types";

const LEVEL_ORDER: Record<SchoolLevel, number> = {
  초등학교: 0,
  중학교: 1,
  고등학교: 2,
};

function normalizedAddress(value: string) {
  return value.normalize("NFKC").replace(/[\s(),.-]/g, "").toLowerCase();
}

function balancedLimit(schools: NearbySchool[], limit: number) {
  const sorted = [...schools].sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      a.name.localeCompare(b.name, "ko"),
  );
  const groups = (["초등학교", "중학교", "고등학교"] as const).map(
    (level) => sorted.filter((school) => school.level === level),
  );
  const selected: NearbySchool[] = [];

  for (let index = 0; selected.length < limit; index += 1) {
    let added = false;
    for (const group of groups) {
      const school = group[index];
      if (school) {
        selected.push(school);
        added = true;
        if (selected.length === limit) break;
      }
    }
    if (!added) break;
  }

  return selected;
}

export function selectSchools(
  schools: NearbySchool[],
  district: string,
  dong: string,
  limit = 6,
): Pick<PlacesResponse, "schools" | "schoolScope" | "note"> {
  const districtToken = normalizedAddress(district);
  const dongToken = normalizedAddress(dong);
  const inDistrict = schools.filter((school) =>
    normalizedAddress(school.address).includes(districtToken),
  );
  const inDong = inDistrict.filter((school) =>
    normalizedAddress(school.address).includes(dongToken),
  );

  if (inDong.length > 0) {
    return {
      schools: balancedLimit(inDong, limit),
      schoolScope: "same-dong",
      note: `${dong} 주소가 확인되는 학교입니다. 직선거리 순이나 배정학교 정보가 아닙니다.`,
    };
  }

  if (inDistrict.length > 0) {
    return {
      schools: balancedLimit(inDistrict, limit),
      schoolScope: "same-district",
      note: `${dong} 주소 일치 결과가 없어 ${district} 소재 학교 일부를 표시합니다. 직선거리 순이나 배정학교 정보가 아닙니다.`,
    };
  }

  return {
    schools: [],
    schoolScope: "none",
    note: `${district}에서 표시할 학교 정보를 찾지 못했습니다.`,
  };
}
