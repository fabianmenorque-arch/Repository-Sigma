from backend.models import (
    Activo,
    Catalogo,
    Repuesto,
)


def test_agregar_repuesto():

    activo = Activo(
        uuid="1",
        codigo_sigma="TRA-0001",
        activo_key="KEY",
        sector="Trapiche",
        ubicacion="Molino",
        maquina="Molino 1",
        modelo="FCB",
    )

    activo.agregar_repuesto(
        Repuesto(
            descripcion="Rodamiento"
        )
    )

    assert activo.cantidad_repuestos == 1


def test_catalogo():

    catalogo = Catalogo()

    activo = Activo(
        uuid="1",
        codigo_sigma="TRA-0001",
        activo_key="KEY",
        sector="Trapiche",
        ubicacion="Molino",
        maquina="Molino 1",
        modelo="FCB",
    )

    catalogo.agregar(activo)

    assert catalogo.cantidad_activos == 1

    assert (
        catalogo.buscar_codigo("TRA-0001")
        is activo
    )

    assert (
        catalogo.buscar_maquina("Molino 1")
        is activo
    )

    assert len(
        catalogo.buscar_sector("Trapiche")
    ) == 1
