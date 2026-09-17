export interface SopSection {
  id: string;
  title: string;
  source: string;
  chapter: string;
  keywords: string[];
  content: string;
}

export const OPERATIONS_SOP: SopSection[] = [
  {
    id: 'incident-triage', title: 'Incident 分級與初步處置', source: 'iRent Ops SOP', chapter: '2.1 Incident Triage',
    keywords: ['事故', 'incident', '分級', '嚴重', '刮傷', '碰撞', '風險'],
    content: '先確認人身安全與車輛是否可安全移動。高風險或影響行車安全案件應停止派租、標記高優先並由管理員確認派工；不可只依 AI 信心度自動結案。'
  },
  {
    id: 'cleaning', title: '清潔異常處理', source: 'iRent Ops SOP', chapter: '3.2 Cleaning',
    keywords: ['清潔', '髒污', '垃圾', '異味', '車內'],
    content: '清潔案件需記錄位置、污染類型與照片。若下一筆預約在 30 分鐘內，優先評估換車或緊急清潔；完工後需上傳對應位置照片。'
  },
  {
    id: 'maintenance-review', title: '維修完工與人工覆核', source: 'iRent Ops SOP', chapter: '4.4 Maintenance Completion',
    keywords: ['維修', '完工', '照片', '覆核', '結案', '補件'],
    content: '完工紀錄必須包含處理說明與完工照片，並與原 Incident 損傷位置對應。低信心、照片不清楚或備註不一致時標記人工確認，不得自動求償或結案。'
  },
  {
    id: 'line-notification', title: 'LINE 營運通知', source: 'iRent Ops SOP', chapter: '5.1 Notification',
    keywords: ['line', '通知', '群組', '訊息', '派發'],
    content: 'LINE 訊息只提供案件所需資訊，避免姓名、電話、租約或其他不必要個資。草稿需由管理員預覽確認後送出，並追蹤 queued、sent、failed 或 not_configured 狀態。'
  },
  {
    id: 'handover', title: '交班檢查清單', source: 'iRent Ops SOP', chapter: '6.1 Shift Handover',
    keywords: ['交班', '早班', '晚班', '摘要', 'sla', '逾時'],
    content: '交班時列出未處理高風險案件、30 分鐘內預約風險、SLA 逾時、未完成維修及 LINE 發送異常。接班人需確認案件負責小隊與下一步。'
  }
];
