from utils.plugins import register_plugins, send_event_to_plugins

NORMALIZATION_PLUGINS = register_plugins("normalization_plugins")


def run_normalization_plugins(event, metadata=None):
    if metadata is None:
        metadata = {}
    return send_event_to_plugins(event, metadata, NORMALIZATION_PLUGINS)
