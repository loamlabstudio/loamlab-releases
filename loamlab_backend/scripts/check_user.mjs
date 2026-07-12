// 查詢單筆交易紀錄（依 order_id 關鍵字模糊比對）
// 執行：cd loamlab_backend && node scripts/check_user.mjs <order_id 關鍵字>
import { makeSupabase } from './_env.mjs';

const keyword = process.argv[2];
if (!keyword) {
    console.error('用法: node scripts/check_user.mjs <order_id 關鍵字>');
    process.exit(1);
}

const supabase = makeSupabase();
const { data, error } = await supabase.from('transactions').select('*').ilike('order_id', `%${keyword}%`);
if (error) { console.error(error.message); process.exit(1); }
console.log('Transactions with order_id:', data);
