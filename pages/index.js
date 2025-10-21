import dynamic from "next/dynamic";
const SolanaAnalyzer = dynamic(() => import("../components/SolanaAnalyzer"), { ssr: false });
export default function Home() { return <div style={{minHeight:'100vh',background:'linear-gradient(135deg,#3b0dab,#0f172a,#1e1b4b)',padding:16}}><div style={{maxWidth:1200,margin:'0 auto'}}><SolanaAnalyzer/></div></div>; }
