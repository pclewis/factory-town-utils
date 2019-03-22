var THREE = require('../third-party/three.js/build/three.min.js');
require('../third-party/three.js/examples/js/controls/FirstPersonControls.js');
require('../third-party/three-instanced-mesh/index.js')(THREE);

const SCALE = new THREE.Vector3(1,0.5,-1);
const WHITE = new THREE.Color('#fff');
const BLACK = new THREE.Color('#000');

let chunkSize = 64; // present in save file, not sure if it's constant

var container;
var camera, controls, scene, renderer;
var clock = new THREE.Clock();
var cluster;
var light;
var info;

var mouse = new THREE.Vector2();
var highlightedBlock = null;
var sticky = null;
var intersectsScene = new THREE.Scene();
var raycaster = new THREE.Raycaster();

const waterGeom = new THREE.PlaneBufferGeometry(chunkSize,chunkSize);
waterGeom.rotateX( Math.PI / 2 );
waterGeom.translate(0, -1 * SCALE.y + 0.1, 0);

const waterMat = new THREE.MeshPhongMaterial( {color: '#00ccff', transparent:true,opacity:0.75, side: THREE.DoubleSide} );

const boxGeom = new THREE.BoxBufferGeometry(1,SCALE.y,1);
const boxMat  = new THREE.MeshLambertMaterial( { color: '#99ff00' } );

function decodeTerrainChunk(terrainChunk)
{
    let d = atob(terrainChunk.columnDataString);
    let array = new Int8Array(new ArrayBuffer(d.length));

    for(let i = 0; i < d.length; i++) {
        array[i] = d.charCodeAt(i) - 0x80;
    }

    return array;
}

function createTerrainMeshes(scene, terrainChunks)
{
    for (let terrainChunk of terrainChunks) {
        let data = decodeTerrainChunk(terrainChunk);
        let geometry = new THREE.PlaneBufferGeometry( chunkSize, chunkSize,
                                                      chunkSize, chunkSize );
        geometry.rotateX( Math.PI / 2 );

        // set vertex heights from saved data
        var vertices = geometry.attributes.position.array;
        for ( var i = 0, j = 0, l = vertices.length; j < l; i ++, j += 3 ) {
            vertices[ j + 1 ] = data[i] * SCALE.y;
        }

        // must compute normals for lighting to work right
        geometry.computeVertexNormals();

        let texture = new THREE.CanvasTexture(
            generateTexture(data, chunkSize+1, chunkSize+1)
        );
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;

        let position = new THREE.Vector3(
            terrainChunk.startCoords[0] + (chunkSize/2),
            0,
            -terrainChunk.startCoords[1] - (chunkSize/2)
        );

        let mesh = new THREE.Mesh( geometry, new THREE.MeshLambertMaterial( { map: texture, side: THREE.DoubleSide, shadowSide: THREE.FrontSide } ) );
        mesh.position.copy( position );
        scene.add( mesh );

        let waterMesh = new THREE.Mesh( waterGeom, waterMat );
        waterMesh.position.copy( position );
        scene.add( waterMesh );
    }
}

function init(save)
{
    container = document.getElementById( 'container' );
    info = document.getElementById('info');

    camera = new THREE.PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 1000 );
    camera.position.set( save.cameraTransform.pX, save.cameraTransform.pY, -save.cameraTransform.pZ );
    camera.quaternion.set( save.cameraTransform.rX, save.cameraTransform.rY, save.cameraTransform.rZ, save.cameraTransform.rW );

    scene = new THREE.Scene();
    scene.background = new THREE.Color( 0xbfd1e5 );

    createTerrainMeshes( scene, save.terrainChunks );

    cluster = new THREE.InstancedMesh( boxGeom, boxMat, save.blocks.length, false, true, true );

    // FIXME this is gross
    let _v3 = new THREE.Vector3();

    for(const [i, b] of save.blocks.entries()) {
        var mesh = new THREE.Mesh( boxGeom );
        mesh.userData.index = i;
        mesh.userData.block = b;

        let [x,y,z] = b.pos.split(',').map( x => parseInt(x) );
        cluster.setColorAt(i, WHITE);
        if (b.b) {
            switch(b.b.type) {
            case "Silo":
            case "Recharger":
            case "Extractor":
            case "Diffuser":
                _v3.set(1,4,1);
                break;
            case "Incinerator":
                _v3.set(1,3,1);
                break;
            case "Crate":
                _v3.set(1,2,1);
                break;
            default:
                _v3.set(3,4,3);
            }
            cluster.setScaleAt(i, _v3 );
            mesh.scale.copy(_v3);
            cluster.setPositionAt( i, _v3.set(x,(y+((_v3.y-1)/2))*SCALE.y,-z) );
            mesh.position.set(x,(y+((_v3.y-1)/2))*SCALE.y,-z);
        } else {
            cluster.setPositionAt( i, _v3.set(x,y*SCALE.y,-z) );
            cluster.setScaleAt(i, _v3.set(1,1,1) );
            mesh.position.set(x,y*SCALE.y,-z);
        }
        intersectsScene.add(mesh);
        mesh.updateMatrixWorld();
    }
    intersectsScene.updateMatrixWorld(true);
    scene.add(cluster);

    light = new THREE.PointLight( 0xffffff, 1, 100 );
    light.position.copy(camera.position);
    light.castShadow = true;
    scene.add( light );

    let sun = new THREE.DirectionalLight( 0xFFFFFF, 1 );
    sun.position.set( 100, 100, 0 );
    sun.castShadow = true;
    sun.shadow.camera.far = 500;
    scene.add( sun );

    renderer = new THREE.WebGLRenderer();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    container.innerHTML = "";
    container.appendChild( renderer.domElement );

    window.addEventListener( 'resize', onWindowResize, false );

    controls = new THREE.FirstPersonControls( camera, container );
    controls.movementSpeed = 100;
    controls.lookSpeed = 0.1;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize( window.innerWidth, window.innerHeight );
    controls.handleResize();
}

function generateTexture( data, width, height ) {
    let vector3 = new THREE.Vector3( 0, 0, 0 );
    let canvas = document.createElement( 'canvas' );
    canvas.width = width;
    canvas.height = height;
    let context = canvas.getContext( '2d' );
    context.fillStyle = '#000';
    context.fillRect( 0, 0, width, height );
    let image = context.getImageData( 0, 0, canvas.width, canvas.height );
    let imageData = image.data;
    for ( let i = 0, j = 0, l = imageData.length; i < l; i += 4, j ++ ) {
        imageData[i + 0] = (data[j] < 0) ? 255 : 0;
        imageData[i + 1] = 255;
        imageData[i + 2] = 0;
    }
    context.putImageData( image, 0, 0 );
    return canvas;
}

function animate() {
    requestAnimationFrame( animate );
    render();
}

function blockUnderCursor() {
    raycaster.setFromCamera( mouse.set(controls.mouseX / controls.viewHalfX,
                                       -controls.mouseY / controls.viewHalfY),
                             camera );
    let intersects = raycaster.intersectObjects( intersectsScene.children );
    return (intersects.length>0) ? intersects[0].object : null;
}

function render() {
    light.position.copy(camera.position);

    controls.activeLook = controls.mouseDragOn;
    controls.update( clock.getDelta() );

    if(!sticky || controls.mouseDragOn) {
        let block = blockUnderCursor();
        if( block ) {
            if( highlightedBlock ) {
                cluster.setColorAt(highlightedBlock.userData.index, WHITE);
            }

            info.innerText = JSON.stringify(block.userData.block,null,2);
            cluster.setColorAt(block.userData.index, BLACK);
            cluster.needsUpdate('colors');

            highlightedBlock = block;
        } else if ( highlightedBlock ) {
            info.innerText = "";
            cluster.setColorAt(highlightedBlock.userData.index, WHITE);
            cluster.needsUpdate('colors');
            highlightedBlock = null;
        }
        if(controls.mouseDragOn) {
            sticky = !!highlightedBlock;
        }
    }

    renderer.render( scene, camera );
}

function magic() {

    let f = document.getElementById('f').files[0];
    let r = new FileReader();

    r.onload = function(e) {
        let save = JSON.parse(e.target.result);
        init(save);
        animate();
    };

    r.readAsText(f);
}
