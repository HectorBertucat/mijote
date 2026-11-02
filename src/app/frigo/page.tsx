import { redirect } from "next/navigation";

// Le Frigo est devenu « Nos plats » : les boîtes sont des portions de la réserve (src/lib/reserve).
export default function Frigo() {
  redirect("/plats");
}
