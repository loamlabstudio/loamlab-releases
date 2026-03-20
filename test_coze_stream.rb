require 'net/http'
require 'uri'
require 'json'

COZE_PAT = "pat_fRWcYMWTolnSr3rte9dInKOaXvKn6EAqRmIcEpJYdxTuNmOf9Ku6aZnK7KH8nxPo"
WORKFLOW_ID = "7613251981235208197" # 從使用者的 debug URL 中抓出的真實工作流 ID

uri = URI("https://api.coze.com/v1/workflow/stream_run")
request = Net::HTTP::Post.new(uri)
request['Authorization'] = "Bearer #{COZE_PAT}"
request['Content-Type'] = 'application/json'

# 模擬 SketchUp 發出的精確封包
payload = {
  workflow_id: WORKFLOW_ID,
  parameters: {
     "image": ["https://i.ibb.co/68zH0z7/1772528741300.jpg"], # 隨便一張真實能讀到的圖
     "prompt": "interior design, high quality, realistic",
     "resolution": "1K",
     "aspect_ratio": "16:9"
  }
}
request.body = JSON.dump(payload)

puts "Sending request to Coze Stream API..."
begin
  response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) do |http|
    http.request(request) do |res|
        res.read_body do |chunk|
            puts chunk
        end
    end
  end
rescue => e
  puts "Error: #{e.message}"
end
