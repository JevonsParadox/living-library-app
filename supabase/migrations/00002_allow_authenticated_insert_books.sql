-- Allow authenticated users to insert books (global metadata)
create policy "Authenticated users can insert books"
  on books for insert
  to authenticated
  with check (true);
