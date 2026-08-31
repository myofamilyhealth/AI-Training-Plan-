# Setting up the team backend

Ten minutes, once. Everything below happens in a browser — nothing to install.

At the end you send me two values. Both are meant to be public and safe to
commit to this repository; the security is in the database rules, not in
keeping them secret. **The one you must never send or commit is the
`service_role` key** — that one bypasses every rule.

## 1. Make the project

1. Go to <https://supabase.com> and sign up (free, GitHub login works).
2. **New project**. Name it whatever you like — `vacaville-composite` is fine.
3. Set a database password. Save it in your password manager; you will rarely
   need it, and there is no way to recover it.
4. Region: **West US (North California)** is closest.
5. Wait about two minutes for it to finish building.

## 2. Turn off email confirmation

Riders sign in with a username and a password and never see an email field.
The page turns `natedog` into `natedog@vacaville.team` before it talks to
Supabase, so Supabase has an address to key accounts on — but nothing is ever
sent to it, and if confirmation is left on, nobody can log in.

1. **Authentication** → **Sign In / Providers** → **Email**.
2. Turn **Confirm email** OFF.
3. Leave **Enable email provider** ON — that is what username/password uses.
4. Save.

## 3. Create the tables

1. **SQL Editor** → **New query**.
2. Paste the whole of [`schema.sql`](schema.sql) and hit **Run**.
3. It should say Success. It is safe to run twice if you are unsure.

That creates the rider, team, membership and ride tables, all the access rules,
and the Vacaville Composite team with the join code **DIRTDOGS**.

## 4. Send me the two values

**Project Settings** → **API** (or **Data API**):

- **Project URL** — looks like `https://abcdefghijklm.supabase.co`
- **anon public** key — a long string starting `eyJ...`

Paste both to me and I will wire them into the page.

Again: the box labelled `service_role` on that same screen is the one that
bypasses every rule in the database. Do not paste it here, into the repository,
or into any chat.

## Afterwards

- **Sign up first.** The first account to enter DIRTDOGS becomes the coach.
  Coaches can remove riders and promote another rider to coach.
- **Forgotten password?** There is no email, so there is no reset link. You fix
  it in **Authentication → Users**: find the rider, and set a new password.
  Ten seconds, and it is the price of nobody needing an email address.
- **Changing the join code** is one line in the SQL editor:
  `update teams set join_code = 'NEWCODE' where name = 'Vacaville Composite';`
