-- Migration 00006: Allow recommended edges
-- Adds 'recommended' to the system edge types so book→book recommendation edges
-- can be inserted and read by authenticated users.

drop policy "Users can insert own or system edges" on edges;

create policy "Users can insert own or system edges"
  on edges for insert
  to authenticated
  with check (
    source_id = auth.jwt() ->> 'sub'
    or edge_type in ('wrote', 'belongs_to', 'linked_to', 'recommended')
  );

drop policy "Users can read own and system edges" on edges;

create policy "Users can read own and system edges"
  on edges for select
  to authenticated
  using (
    source_id = auth.jwt() ->> 'sub'
    or edge_type in ('wrote', 'belongs_to', 'linked_to', 'recommended')
  );
