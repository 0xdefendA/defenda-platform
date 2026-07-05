import pytest

import query


def test_valid_criteria_passes():
    c = "source='cloudtrail' AND STRING(details.eventname) = 'ConsoleLogin'"
    assert query.validate_criteria(c) == c


def test_empty_criteria_means_browse_mode():
    assert query.validate_criteria("") == ""
    assert query.validate_criteria("   ") == ""


def test_generate_sql_empty_criteria_browses_recent():
    sql = query.generate_query_sql("", "proj", minutes=60, limit=100)
    assert "WHERE utctimestamp >=" in sql
    assert "() AND" not in sql
    assert "ORDER BY utctimestamp DESC" in sql


def test_semicolon_rejected():
    with pytest.raises(query.InvalidCriteria):
        query.validate_criteria("source='x'; DROP TABLE events")


def test_forbidden_keywords_rejected():
    for bad in [
        "1=1 UNION ALL SELECT * FROM information_schema.tables",
        "DELETE FROM events WHERE 1=1",
        "source='x' OR EXISTS (SELECT 1 FROM foo); INSERT INTO x",
        "merge into events",
    ]:
        with pytest.raises(query.InvalidCriteria):
            query.validate_criteria(bad)


def test_comments_rejected():
    with pytest.raises(query.InvalidCriteria):
        query.validate_criteria("source='x' -- sneaky")
    with pytest.raises(query.InvalidCriteria):
        query.validate_criteria("source='x' /* sneaky */")


def test_keyword_matching_is_word_bounded():
    # 'update' inside a JSON path should not trip the denylist
    c = "STRING(details.lastupdated) = '2026-01-01'"
    assert query.validate_criteria(c) == c


def test_generate_sql_contains_criteria_and_partition_filter():
    sql = query.generate_query_sql("source='onelogin'", "proj", minutes=90, limit=50)
    assert "`proj.defenda_data_lake.events`" in sql
    assert "(source='onelogin')" in sql
    assert "INTERVAL 90 MINUTE" in sql
    assert "LIMIT 50" in sql
    assert "utctimestamp >=" in sql


def test_clamping():
    sql = query.generate_query_sql("source='x'", "proj", minutes=10**9, limit=10**9)
    assert f"INTERVAL {query.MAX_MINUTES} MINUTE" in sql
    assert f"LIMIT {query.MAX_LIMIT}" in sql

    sql = query.generate_query_sql("source='x'", "proj", minutes=-5, limit=0)
    assert "INTERVAL 1 MINUTE" in sql
    assert "LIMIT 1" in sql

    sql = query.generate_query_sql("source='x'", "proj", minutes="nope", limit=None)
    assert f"INTERVAL {query.DEFAULT_MINUTES} MINUTE" in sql
    assert f"LIMIT {query.DEFAULT_LIMIT}" in sql
