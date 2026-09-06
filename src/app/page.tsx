import { redirect } from "next/navigation";

export default function Home() {
  // The landing screen is the bet check, not the board: the first question is
  // "should I take this one?", not "show me everything".
  redirect("/check");
}
