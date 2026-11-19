-- Allow authenticated users to insert wrote edges (author → book)
-- Broadens the existing INSERT policy to permit wrote edges
-- alongside user-sourced edges

drop policy "Users can insert own edges" on edges;

create policy "Users can insert own or wrote edges"
  on edges for insert
  to authenticated
  with check (
    source_id = auth.jwt() ->> 'sub'
    or edge_type = 'wrote'
  );
