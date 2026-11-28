# Mail domain: triển khai online

Trạng thái mã: có giao diện và kiểm thử cục bộ. Bản này chưa tự triển khai bảng/API/Worker hoặc đổi routing. Không cần App Password Gmail trong trình duyệt.

## Luồng và quyền

Web đăng nhập Supabase → Edge Function `domain-mail` → các bảng `mxh_domain_mailboxes`, `mxh_domain_messages`. Thành viên viewer được đọc; editor/admin tạo địa chỉ. Các thành viên trong cùng kho dùng chung hộp thư, giống quyền đọc kho tài nguyên hiện tại. Không cung cấp hộp thư công khai.

Cloudflare catch-all → Email Worker → API ingest có secret riêng → hộp thư web. Worker tiếp tục chuyển thư đến Gmail đã xác minh `nguyenduynd1805@gmail.com`. Không đổi MX, nameserver hay bản ghi website.

## Bật dịch vụ

1. Chạy `supabase/domain-mail.sql` trong SQL Editor của project `uecdimszburryafqtszf`, sau schema hiện tại. Đây là script setup bổ sung, không ghi đè tài nguyên/cài đặt đang có.
2. Tạo một secret ngẫu nhiên ít nhất 32 byte bằng trình quản lý mật khẩu. Đặt cùng giá trị ở hai nơi, không đưa vào repo hoặc gửi trong chat:
   - Supabase Edge Functions Secrets: `DOMAIN_MAIL_INGEST_SECRET`.
   - Cloudflare Worker Secret: `DOMAIN_MAIL_INGEST_SECRET`.
3. Đặt Supabase secret `MAIL_DOMAIN=devsepa.id.vn`. Các biến `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` do môi trường Supabase cung cấp; service role tuyệt đối không đưa vào web.
4. Triển khai `supabase/functions/domain-mail` với JWT gateway verification **tắt** (`supabase functions deploy domain-mail --no-verify-jwt`). Bắt buộc tắt gateway cho Worker gọi bằng secret; handler tự xác minh JWT người dùng và tư cách thành viên cho các thao tác web. Chưa bật catch-all cho tới khi kiểm tra API tạo/list hộp thư thành công.
5. Trong `cloudflare/domain-mail`: chạy `npm ci`, kiểm tra `wrangler.toml` đúng URL và Gmail đích, đặt secret bằng `npx wrangler secret put DOMAIN_MAIL_INGEST_SECRET`, sau đó `npm run check` và `npm run deploy`. Gmail đích phải còn Verified trong Email Routing.
6. Publish các file web `index.html`, `domain-mail.js` cùng các tài nguyên hiện có. Bản local chạy bằng IG-Tool.bat cũng phục vụ file mới.
7. Trên web đăng nhập → Kho Gmail → **Mail domain** → tạo một địa chỉ thử. Sau đó đổi catch-all ở Cloudflare từ **Send to an email** sang **Send to a Worker**, chọn `mxh-domain-mail`.
8. Gửi một thư thử từ hộp thư khác tới địa chỉ vừa tạo, kiểm tra đủ cả tab Mail domain và Gmail. Chỉ kết luận hoạt động online sau bước này.

## Giới hạn và vận hành

- Chỉ thư mới gửi sau khi bật Worker và tới địa chỉ **đã tạo trên tab** được lưu trên web. Không đồng bộ thư cũ từ Gmail; địa chỉ không đăng ký vẫn chuyển về Gmail.
- Danh sách hiển thị 200 địa chỉ gần nhất; mỗi hộp thư 30 thư mới nhất, tự tải 5 giây. Hiện chưa hỗ trợ phân trang, gửi thư, tệp đính kèm hoặc ảnh từ xa.
- Worker chỉ phân tích thư tối đa 2 MiB; nội dung lưu tối đa 128 Ki ký tự, subject/sender tối đa 2.000 ký tự. Thư quá lớn hoặc lỗi lưu vẫn chuyển Gmail. Worker ghi duy nhất mã `domain_mail_not_stored`; kiểm tra log khi web thiếu thư. Không có cơ chế nhập bù từ Gmail.
- Nếu Gmail forwarding lỗi, Worker báo lỗi cho nền tảng; thao tác lưu chống trùng bằng SHA-256 và người nhận. Không bảo đảm nhà gửi sẽ gửi lại thư.
- Thiết lập lịch dọn dữ liệu trong Supabase Cron, ví dụ hàng ngày chạy `delete from public.mxh_domain_messages where received_at < now() - interval '7 days';`. Script setup chưa tự tạo cron, nên chưa có retention tự động. Theo dõi dung lượng để tránh chạm quota gói đang dùng.
- Khi cần quay lại cơ chế cũ: đổi catch-all về **Send to an email** và Gmail đã xác minh. Các thư web đã lưu không bị xóa.

## Kiểm chứng

`node --test domain-mail.test.cjs email-worker.test.cjs domain-mail-ui.test.cjs domain-mail-app.test.cjs`

Test dùng tài khoản/thư mẫu và API giả lập, không gửi thư thật. Cần kết nối lại Supabase/Cloudflare để triển khai; token connector hiện trả `token_revoked` trong lần kiểm tra ngày 27/11/2026.
