from utils.plugins import register_plugins, send_event_to_plugins

ENRICHMENT_PLUGINS = register_plugins("enrichment_plugins")


def run_enrichment_plugins(event, metadata=None):
    if metadata is None:
        metadata = {}
    return send_event_to_plugins(event, metadata, ENRICHMENT_PLUGINS)
