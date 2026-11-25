# Kết nối Supabase Free

Ứng dụng dùng Supabase Auth và PostgreSQL. Chỉ người có dòng trong `mxh_members` mới được xem kho; `editor` và `admin` được ghi, `viewer` chỉ xem. Không có đăng ký công khai trong giao diện.

Project hiện tại đã được cấu hình bằng URL và publishable key trong `supabase-config.js`. Đây là key dành cho trình duyệt; quyền được kiểm tra bằng RLS trên máy chủ. Không đưa database password, `service_role`, access token quản trị hoặc `sb_secret_` vào mã nguồn.

Để cài vào project mới: dùng gói Free, chạy `schema.sql`, rồi cập nhật `supabase-config.js`. Không cần bật dịch vụ trả phí. Project Free có giới hạn dung lượng/băng thông và có thể bị tạm dừng khi ít hoạt động; xem trang Usage của project.

Để cấp quyền cho người khác:

1. Vào Supabase → Authentication → Users → Add user → Create new user. Nhập email, đặt mật khẩu riêng và bật Auto Confirm User. Người dùng đăng nhập web bằng tài khoản này.
2. Trong SQL Editor, thay email và vai trò trong câu lệnh sau rồi chạy:

```sql
insert into public.mxh_members(user_id,role)
select id,'editor' from auth.users
where lower(email)=lower('member@example.com')
on conflict(user_id) do update set role=excluded.role;
```

Chọn `viewer` để chỉ xem, `editor` để thao tác tài nguyên, `admin` cho chủ kho. Các vai trò không được tự thêm thành viên qua Data API; quản lý cấp quyền qua Dashboard/SQL Editor.

Để thu hồi quyền, xoá dòng tương ứng khỏi `mxh_members`. Các yêu cầu mới tới database sẽ bị chặn. Dữ liệu đã tải trước đó không thể thu hồi khỏi bộ nhớ hay bản sao lưu của người đã được cấp quyền; đăng xuất sẽ xoá dữ liệu khỏi màn hình và bộ nhớ của ứng dụng.

Sau khi đăng nhập, vào **Cài đặt → Chuyển dữ liệu cũ từ trình duyệt** để chuyển tài khoản chưa có trên Supabase. Bước này cần xác nhận, bỏ qua UID trùng và giữ nguyên bản cũ. Chỉ đọc được dữ liệu cũ trên đúng trình duyệt và địa chỉ web đã nhập trước đó; từ file local có thể xuất CSV để nhập trên web.

Nút **Tải lại** lấy dữ liệu mới từ kho chung; cần đóng form đang sửa trước khi tải lại. Khi có xung đột, ứng dụng báo lỗi và yêu cầu tải lại. Không tự chuyển sang lưu local khi kết nối cloud lỗi. Nhập lớn được chia thành các giao dịch 1.000 tài khoản; nếu một đợt sau thất bại, thông báo ghi rõ số mục đã lưu để kiểm tra trước khi thử lại.

Các bảng:

| Bảng | Nội dung |
|---|---|
| `mxh_resources` | Mỗi tài khoản một dòng; cột UID, email, status, group_name và dữ liệu đầy đủ trong JSONB |
| `mxh_meta` | Cài đặt và thống kê theo ngày |
| `mxh_members` | User ID của Supabase Auth và vai trò viewer/editor/admin |

Ví dụ SQL (sau khi đã có dữ liệu):

```sql
select uid, email, status, group_name
from public.mxh_resources
where status = 'live';

select group_name, count(*)
from public.mxh_resources
group by group_name;

select pg_size_pretty(pg_database_size(current_database()));
```

Kiểm tra local:

```text
node --test supabase-store.test.cjs
node --test cloud-ui.test.cjs
node interaction-check.cjs
```

Các bài kiểm tra Node dùng API mô phỏng cho phân trang, phiên đăng nhập, lỗi mạng, xung đột và trạng thái giao diện. Kiểm tra SQL giao dịch/RLS đã được chạy trên project thực bằng giao dịch hoàn tác. Kiểm tra trình duyệt gồm màn hình đăng nhập với SDK thật và thao tác dữ liệu bằng phiên mô phỏng. Mật khẩu người dùng không được thu thập để kiểm tra đăng nhập.

Tài liệu chính thức: [Data API](https://supabase.com/docs/guides/api), [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
