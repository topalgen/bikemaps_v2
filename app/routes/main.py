from flask import Blueprint, render_template
from app.data import get_stats

bp = Blueprint("main", __name__)


@bp.route("/")
def landing():
    stats = get_stats()
    return render_template("landing.html", stats=stats)
