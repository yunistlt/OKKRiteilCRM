#!/usr/bin/env python3
import os
import sys

# Подключаемся к Supabase напрямую через psycopg2
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("Установка psycopg2...")
    os.system("pip install psycopg2-binary -q")
    import psycopg2
    import psycopg2.extras

# Параметры из .env.local
DATABASE_URL = "postgresql://postgres.lywtzgntmibdpgoijbty:dajgib-xiXdeh-4tedka@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

print("🔍 Подключаюсь к БД...\n")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # 1. Проверим какие колонки есть в widget_sessions
    print("=" * 80)
    print("📋 СХЕМА ТАБЛИЦЫ widget_sessions:")
    print("=" * 80)
    cur.execute("""
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = 'widget_sessions' 
        AND table_schema = 'public'
        ORDER BY ordinal_position
    """)
    
    for row in cur.fetchall():
        col_name = row[0]
        data_type = row[1]
        nullable = "NULL" if row[2] == 'YES' else "NOT NULL"
        default = row[3] if row[3] else ""
        print(f"  {col_name:25} {data_type:20} {nullable:10} {default}")
    
    # 2. Посмотрим сессии с этим номером
    print("\n" + "=" * 80)
    print("🔎 ИЩЕМ СЕССИИ С НОМЕРОМ +79276127124:")
    print("=" * 80)
    
    # Попробуем разные варианты поиска
    search_patterns = [
        "79276127124",
        "1279276127124",
        "+79276127124",
    ]
    
    for pattern in search_patterns:
        cur.execute("""
            SELECT id, created_at, updated_at, visitor_id, domain
            FROM widget_sessions
            WHERE CAST(id AS TEXT) LIKE %s
               OR domain LIKE %s
               OR visitor_id LIKE %s
            LIMIT 1
        """, (f"%{pattern}%", f"%{pattern}%", f"%{pattern}%"))
        
        result = cur.fetchone()
        if result:
            print(f"\n✅ Найдена сессия (ищем по паттерну '{pattern}'):")
            for col, val in result.items():
                print(f"  {col}: {val}")
            
            # Посмотрим её сообщения
            session_id = result['id']
            cur.execute("""
                SELECT role, content, created_at 
                FROM widget_messages 
                WHERE session_id = %s
                ORDER BY created_at
            """, (session_id,))
            
            messages = cur.fetchall()
            print(f"\n  📝 Диалог ({len(messages)} сообщений):")
            for msg in messages:
                role = "👤 Клиент" if msg['role'] == 'user' else "🤖 Лена"
                content = msg['content'][:100]
                print(f"     {role}: {content}...")
            
            break
    
    if not result:
        print("❌ Не найдено ни одной сессии с этим номером")
        
        # Посмотрим последние сессии вообще
        print("\n📌 ПОСЛЕДНИЕ 5 СЕССИЙ В БД:")
        cur.execute("""
            SELECT id, created_at, domain 
            FROM widget_sessions 
            ORDER BY created_at DESC 
            LIMIT 5
        """)
        
        for row in cur.fetchall():
            print(f"  {row['created_at']}: {row['domain']} ({row['id']})")
    
    # 3. Проверим какие таблицы вообще есть в public schema
    print("\n" + "=" * 80)
    print("📊 ТАБЛИЦЫ В PUBLIC SCHEMA:")
    print("=" * 80)
    cur.execute("""
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
    """)
    
    tables = [row[0] for row in cur.fetchall()]
    for i, table in enumerate(tables, 1):
        print(f"  {i:2}. {table}")
    
    conn.close()
    print("\n✅ Готово!")
    
except Exception as e:
    print(f"❌ Ошибка: {e}")
    sys.exit(1)
