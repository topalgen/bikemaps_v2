from flask import Blueprint, render_template, jsonify
from app.data import get_accidents

bp = Blueprint("heatmap", __name__, url_prefix="/heatmap")


@bp.route("/")
def index():
    return render_template("heatmap.html")


@bp.route("/data")
def data():
    return jsonify(get_accidents())
