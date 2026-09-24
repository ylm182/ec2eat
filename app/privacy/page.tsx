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
        定位只會喺你按掣後要求權限；精確位置只用於今次要求，唔會寫入選擇記錄或瀏覽器儲存。亦可以手動揀地區。Google
        登入唔會授權讀取 Calendar。
      </p>
      <p>
        Calendar
        連接係自選，只讀取主要日曆附近行程，唔會更改行程。服務設定完成後，行程標題及地點可短暫交畀
        Google Gemini
        提取粗略提示；唔會儲存原文、參與者或模型思考內容，亦唔會交畀
        Laya。授權更新憑證會經 Google KMS
        加密儲存，並提供斷開按鈕。天氣資料只喺服務及內容使用設定完成後啟用。第三方處理地區可能唔同於香港資料庫。測試情境均會清楚標示；餐廳搜尋仍未接通。
      </p>
    </article>
  );
}
