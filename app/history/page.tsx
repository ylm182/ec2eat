import { HistoryFlow } from "@/components/HistoryFlow";
export default function History() {
  return (
    <>
      <div className="eyebrow">你的選擇，一次一次</div>
      <h1 className="small-title">之前點樣揀？</h1>
      <p>揀咗餐廳，唔代表已經去過。翻轉卡片，睇返當時嘅答案。</p>
      <HistoryFlow />
    </>
  );
}
