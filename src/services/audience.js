// Which campaign (and language) a lead belongs to is told by its `source`:
//   ct_registry / csv_import …  new LLCs with a Latino signal  → Spanish   → Instantly campaign "llc"
//   gmaps                       Google Maps, no website        → English   → campaign "maps"
export const MAPS_SOURCE = 'gmaps';

export const ENGLISH_SOURCES = [MAPS_SOURCE];
export const isEnglishSource = (source) => ENGLISH_SOURCES.includes(source);
