import { useParams } from "react-router-dom";
import RealtimeAssist from "./RealtimeAssist.jsx";
import MockInterview from "./MockInterview.jsx";

export default function Interview() {
  const { mode = "realtime" } = useParams();
  const isMock = mode === "mock";

  return (
    <main className={isMock ? "page mock-page rt-v2-page" : "page mock-page rt-v2-page"}>
      {isMock ? <MockInterview /> : <RealtimeAssist />}
    </main>
  );
}
