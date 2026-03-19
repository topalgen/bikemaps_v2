from flask import Flask


def create_app():
    app = Flask(__name__)

    from app.routes.main import bp as main_bp
    from app.routes.heatmap import bp as heatmap_bp
    from app.routes.crossings import bp as crossings_bp
    from app.routes.route_planner import bp as route_planner_bp

    app.register_blueprint(main_bp)
    app.register_blueprint(heatmap_bp)
    app.register_blueprint(crossings_bp)
    app.register_blueprint(route_planner_bp)

    return app
