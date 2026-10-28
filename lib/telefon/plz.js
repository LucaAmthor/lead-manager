import PLZ from "@/lib/telefon/plz-de.json";

// Postleitzahl → Ort(e). Daten: GeoNames (CC BY 4.0) über zauberware/postal-codes-json-xml-csv, Ortsteile zusammengefasst.
export function orteZurPlz(eingabe) {
  const plz = (String(eingabe || "").replace(/\D/g, "").match(/^\d{5}/) || [""])[0];
  const roh = plz ? PLZ[plz] : "";
  return { plz, orte: roh ? roh.split("|") : [] };
}
