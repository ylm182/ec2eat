export default function Privacy() {
  return (
    <article className="prose">
      <div className="eyebrow">ec2eat</div>
      <h1 className="small-title">你嘅資料</h1>
      <p>
        ec2eat 係私人應用程式，只限獲邀 Google
        帳戶使用。登入後，伺服器會核對帳戶權限，並讀取基本個人設定。每個帳戶只可讀取自己嘅資料。決策流程會儲存你選擇嘅地區、原本問題同答案，方便重新載入；示範頁答案只留喺頁面記憶體。
      </p>
      <p>
        目前餐廳搜尋、定位、Calendar 同 AI 服務尚未啟用，唔會提供虛構餐廳或收集
        Calendar 內容。Google 登入唔會授權讀取 Calendar。
      </p>
      <p>
        正式開放決策功能前，會補齊資料保留、第三方處理、斷開連接同刪除資料操作嘅說明。
      </p>
    </article>
  );
}
