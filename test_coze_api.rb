require 'net/http'
require 'uri'
require 'json'

# ==========================================
# Coze API 第一性原理測試腳本 (Minimal Reproducible Example)
# 目的：跳開 SketchUp 複雜環境，直接用最純粹的 Ruby 叩門
# ==========================================

COZE_PAT = "pat_fRWcYMWTolnSr3rte9dInKOaXvKn6EAqRmIcEpJYdxTuNmOf9Ku6aZnK7KH8nxPo"
WORKFLOW_ID = "7612576046118010896"
BOT_ID = "7613595096965382149"

puts "===================================="
puts "開始測試 Cose Workflow API (同步)"
puts "Workflow ID: #{WORKFLOW_ID}"
puts "Bot ID:      #{BOT_ID}"
puts "===================================="

# 我們先不用傳圖片 file_id (因為要測是不是 workflow 找不到，而不是圖片上傳錯誤)
# 只要 API 連線成功，即使給空參數，它也會回報 "參數錯誤" 而非 "Workflow not found"
uri = URI("https://api.coze.com/v1/workflow/run")
request = Net::HTTP::Post.new(uri)
request['Authorization'] = "Bearer #{COZE_PAT}"
request['Content-Type'] = 'application/json'

payload = {
  workflow_id: WORKFLOW_ID,
  bot_id: BOT_ID,
  parameters: {
     prompt: "test",
     images: [],
     enable_base64_output: false
  }
}

request.body = JSON.dump(payload)

begin
  response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
    http.request(request)
  end
  
  puts "\n[HTTP 狀態碼]: #{response.code}"
  puts "[完整回傳內容]:"
  puts JSON.pretty_generate(JSON.parse(response.body))
rescue => e
  puts "例外錯誤: #{e.message}"
end
