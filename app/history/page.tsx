import Link from "next/link";
export default function History() {
  return (
    <>
      <div className="eyebrow">你的選擇，一次一次</div>
      <h1 className="small-title">之前食過啲咩？</h1>
      <div className="empty">
        <span aria-hidden>◷</span>
        <h2>歷史記錄準備中</h2>
        <p>
          之後可以喺呢度翻轉餐廳卡，睇返當時點樣揀。
          <br />
          揀咗餐廳，唔代表已經去過。
        </p>
        <Link href="/">返主頁 →</Link>
      </div>
    </>
  );
}
