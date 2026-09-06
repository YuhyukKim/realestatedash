export type SchoolScope =
  | "same-dong"
  | "same-district"
  | "dong-name"
  | "none";

export type SchoolLevel = "초등학교" | "중학교" | "고등학교";

export type NearbySchool = {
  code: string;
  name: string;
  level: SchoolLevel;
  address: string;
  phone: string | null;
  homepage: string | null;
  foundation: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type PlacesResponse = {
  location: {
    district: string;
    dong: string;
    apartment: string | null;
    mapQuery: string;
  };
  schools: NearbySchool[];
  schoolScope: SchoolScope;
  note: string;
  source: {
    name: string;
    url: string;
    fetchedAt: string | null;
    dataYear?: number;
  };
};
