"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Account } from "@/components/Account";
import { EntrySwipe } from "@/components/EntrySwipe";
import { QuestionArt } from "@/components/QuestionArt";
export default function Home() {
  const [uid, setUid] = useState<string | null>(null);
  const router = useRouter();
  return <div className="home-screen"><Account onAuthorizationChange={setUid}/>
    {uid ? <EntrySwipe kind="home" onChoose={direction => {
      if (direction === "right") {
        sessionStorage.removeItem(`ec2eat.session.${uid}`);
        router.push("/decide");
      } else router.push("/history");
    }}/> : <QuestionArt kind="home"/>}
  </div>;
}
